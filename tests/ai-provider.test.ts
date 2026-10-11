import { describe, expect, it } from "vitest";
import {
  AiProviderError,
  requestAiText,
  type AiHttpRequest,
  type AiHttpResponse,
} from "../src/ai-provider";

function recorder(response: AiHttpResponse): {
  requests: AiHttpRequest[];
  request: (input: AiHttpRequest) => Promise<AiHttpResponse>;
} {
  const requests: AiHttpRequest[] = [];
  return {
    requests,
    request: async (input) => {
      requests.push(input);
      return response;
    },
  };
}

describe("AI provider requests", () => {
  it("uses one OpenAI-compatible contract for Ark and OpenAI", async () => {
    for (
      const [provider, expectedUrl] of [
        ["ark", "https://ark.cn-beijing.volces.com/api/v3/chat/completions"],
        ["openai", "https://api.openai.com/v1/chat/completions"],
      ] as const
    ) {
      const http = recorder({
        status: 200,
        json: {
          choices: [{ message: { content: `${provider}-result` } }],
        },
        text: "",
      });

      const result = await requestAiText({
        provider,
        apiKey: "secret-value",
        model: "writing-model",
        systemPrompt: "只整理，不虚构。",
        userPrompt: "原始内容",
      }, http.request);

      expect(result).toBe(`${provider}-result`);
      expect(http.requests).toHaveLength(1);
      expect(http.requests[0]?.url).toBe(expectedUrl);
      expect(http.requests[0]?.headers.Authorization).toBe(
        "Bearer secret-value",
      );
      expect(JSON.parse(http.requests[0]?.body ?? "{}")).toEqual({
        model: "writing-model",
        messages: [
          { role: "system", content: "只整理，不虚构。" },
          { role: "user", content: "原始内容" },
        ],
        stream: false,
      });
    }
  });

  it("turns DeepSeek thinking off by default and leaves room for long output", async () => {
    const http = recorder({
      status: 200,
      json: { choices: [{ message: { content: "整理结果" } }] },
      text: "",
    });

    await requestAiText({
      provider: "deepseek",
      apiKey: "deepseek-secret",
      model: "deepseek-flash",
      systemPrompt: "只整理，不虚构。",
      userPrompt: "原始内容",
    }, http.request);

    expect(http.requests[0]?.url).toBe(
      "https://api.deepseek.com/chat/completions",
    );
    expect(JSON.parse(http.requests[0]?.body ?? "{}")).toEqual({
      model: "deepseek-flash",
      messages: [
        { role: "system", content: "只整理，不虚构。" },
        { role: "user", content: "原始内容" },
      ],
      stream: false,
      thinking: { type: "disabled" },
      max_tokens: 32768,
    });
  });

  it("sends the selected DeepSeek thinking effort and ignores reasoning text", async () => {
    const http = recorder({
      status: 200,
      json: {
        choices: [{
          message: { reasoning_content: "先分析……", content: "最终答案" },
        }],
      },
      text: "",
    });

    const result = await requestAiText({
      provider: "deepseek",
      apiKey: "deepseek-secret",
      model: "deepseek-v4-pro",
      thinking: "high",
      systemPrompt: "系统",
      userPrompt: "用户",
    }, http.request);

    expect(result).toBe("最终答案");
    const body = JSON.parse(http.requests[0]?.body ?? "{}");
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("high");
    expect(body).not.toHaveProperty("max_tokens");
  });

  it("maps retired or empty DeepSeek model names to deepseek-flash", async () => {
    for (
      const model of [
        "",
        "deepseek-chat",
        "deepseek-reasoner",
        "deepseek-v4-flash",
      ]
    ) {
      const http = recorder({
        status: 200,
        json: { choices: [{ message: { content: "ok" } }] },
        text: "",
      });
      await requestAiText({
        provider: "deepseek",
        apiKey: "deepseek-secret",
        model,
        systemPrompt: "系统",
        userPrompt: "用户",
      }, http.request);
      expect(JSON.parse(http.requests[0]?.body ?? "{}").model).toBe(
        "deepseek-flash",
      );
    }
  });

  it("does not add DeepSeek-only fields to other providers", async () => {
    const http = recorder({
      status: 200,
      json: { choices: [{ message: { content: "ok" } }] },
      text: "",
    });
    await requestAiText({
      provider: "custom",
      baseUrl: "https://llm.example.com/v1",
      apiKey: "secret",
      model: "deepseek-chat",
      thinking: "high",
      systemPrompt: "系统",
      userPrompt: "用户",
    }, http.request);
    const body = JSON.parse(http.requests[0]?.body ?? "{}");
    expect(body.model).toBe("deepseek-chat");
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body).not.toHaveProperty("max_tokens");
  });

  it("explains how to recover when DeepSeek rejects a model name", async () => {
    const http = recorder({
      status: 400,
      json: { error: { message: "Model Not Exist" } },
      text: "",
    });

    await expect(requestAiText({
      provider: "deepseek",
      apiKey: "deepseek-secret",
      model: "deepseek-old-model",
      systemPrompt: "系统",
      userPrompt: "用户",
    }, http.request)).rejects.toThrow(/Model Not Exist.*deepseek-flash/);
  });

  it("uses the native Anthropic Messages contract for Claude", async () => {
    const http = recorder({
      status: 200,
      json: {
        content: [
          { type: "text", text: "第一段" },
          { type: "text", text: "第二段" },
        ],
      },
      text: "",
    });

    const result = await requestAiText({
      provider: "anthropic",
      apiKey: "claude-secret",
      model: "claude-model",
      systemPrompt: "保持事实准确。",
      userPrompt: "整理这段内容。",
    }, http.request);

    expect(result).toBe("第一段\n第二段");
    expect(http.requests[0]?.url).toBe(
      "https://api.anthropic.com/v1/messages",
    );
    expect(http.requests[0]?.headers).toMatchObject({
      "x-api-key": "claude-secret",
      "anthropic-version": "2023-06-01",
    });
    expect(JSON.parse(http.requests[0]?.body ?? "{}")).toEqual({
      model: "claude-model",
      max_tokens: 8192,
      system: "保持事实准确。",
      messages: [{ role: "user", content: "整理这段内容。" }],
    });
  });

  it("allows a custom OpenAI-compatible base URL without duplicate slashes", async () => {
    const http = recorder({
      status: 200,
      json: { choices: [{ message: { content: "完成" } }] },
      text: "",
    });

    await requestAiText({
      provider: "custom",
      apiKey: "custom-secret",
      model: "custom-model",
      baseUrl: "https://llm.example.com/v1/",
      systemPrompt: "system",
      userPrompt: "user",
    }, http.request);

    expect(http.requests[0]?.url).toBe(
      "https://llm.example.com/v1/chat/completions",
    );
  });

  it("returns a readable provider error without exposing the API key", async () => {
    const http = recorder({
      status: 401,
      json: { error: { message: "invalid authentication" } },
      text: "{\"error\":\"invalid authentication\"}",
    });

    const promise = requestAiText({
      provider: "openai",
      apiKey: "super-private-key",
      model: "writing-model",
      systemPrompt: "system",
      userPrompt: "user",
    }, http.request);

    await expect(promise).rejects.toBeInstanceOf(AiProviderError);
    await expect(promise).rejects.toThrow(
      "OpenAI 请求失败（401）：invalid authentication",
    );
    await expect(promise).rejects.not.toThrow("super-private-key");
  });

  it("rejects an empty model before sending a network request", async () => {
    const http = recorder({ status: 200, json: {}, text: "" });

    await expect(requestAiText({
      provider: "ark",
      apiKey: "secret",
      model: " ",
      systemPrompt: "system",
      userPrompt: "user",
    }, http.request)).rejects.toThrow("请先填写 AI 模型名称");
    expect(http.requests).toHaveLength(0);
  });
});
