import type { AiProvider } from "./settings";

export interface AiHttpRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export interface AiHttpResponse {
  status: number;
  json: unknown;
  text: string;
}

export type AiHttpRequester = (
  request: AiHttpRequest,
) => Promise<AiHttpResponse>;

export interface AiTextRequest {
  provider: AiProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
  systemPrompt: string;
  userPrompt: string;
}

const PROVIDER_NAMES: Record<AiProvider, string> = {
  ark: "火山方舟",
  openai: "OpenAI",
  anthropic: "Claude",
  deepseek: "DeepSeek",
  custom: "自定义 AI",
};

const PROVIDER_BASE_URLS: Record<Exclude<AiProvider, "custom">, string> = {
  ark: "https://ark.cn-beijing.volces.com/api/v3",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  deepseek: "https://api.deepseek.com",
};

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function trimTrailingSlashes(value: string): string {
  return value.trim().replace(/\/+$/g, "");
}

export function providerDisplayName(provider: AiProvider): string {
  return PROVIDER_NAMES[provider];
}

export function resolveProviderBaseUrl(
  provider: AiProvider,
  customBaseUrl?: string,
): string {
  if (provider !== "custom") {
    return PROVIDER_BASE_URLS[provider];
  }
  const normalized = trimTrailingSlashes(customBaseUrl ?? "");
  if (!/^https?:\/\/[^/]+/i.test(normalized)) {
    throw new AiProviderError("请填写有效的自定义 AI Base URL");
  }
  return normalized;
}

function extractErrorMessage(json: unknown, fallback: string): string {
  const root = asRecord(json);
  const error = asRecord(root.error);
  const candidates = [
    error.message,
    root.message,
    root.error_description,
    fallback,
  ];
  return candidates.find(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  )?.trim() ?? "未知错误";
}

function extractOpenAiText(json: unknown): string {
  const root = asRecord(json);
  const choice = Array.isArray(root.choices)
    ? asRecord(root.choices[0])
    : {};
  const message = asRecord(choice.message);
  if (typeof message.content === "string") {
    return message.content.trim();
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        const block = asRecord(part);
        return typeof block.text === "string" ? block.text.trim() : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function extractAnthropicText(json: unknown): string {
  const root = asRecord(json);
  if (!Array.isArray(root.content)) {
    return "";
  }
  return root.content
    .map((part) => {
      const block = asRecord(part);
      return block.type === "text" && typeof block.text === "string"
        ? block.text.trim()
        : "";
    })
    .filter(Boolean)
    .join("\n");
}

export async function requestAiText(
  input: AiTextRequest,
  request: AiHttpRequester,
): Promise<string> {
  const apiKey = input.apiKey.trim();
  const model = input.model.trim();
  if (!apiKey) {
    throw new AiProviderError("请先选择或创建 AI API Key");
  }
  if (!model) {
    throw new AiProviderError("请先填写 AI 模型名称");
  }
  const baseUrl = resolveProviderBaseUrl(input.provider, input.baseUrl);
  const anthropic = input.provider === "anthropic";
  const httpRequest: AiHttpRequest = anthropic
    ? {
      url: `${baseUrl}/messages`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        system: input.systemPrompt,
        messages: [{ role: "user", content: input.userPrompt }],
      }),
    }
    : {
      url: `${baseUrl}/chat/completions`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: input.userPrompt },
        ],
        stream: false,
      }),
    };
  let response: AiHttpResponse;
  try {
    response = await request(httpRequest);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AiProviderError(
      `${providerDisplayName(input.provider)} 网络请求失败：${message}`,
    );
  }
  if (response.status < 200 || response.status >= 300) {
    const detail = extractErrorMessage(response.json, response.text);
    throw new AiProviderError(
      `${providerDisplayName(input.provider)} 请求失败（${
        response.status
      }）：${detail}`,
      response.status,
    );
  }
  const text = anthropic
    ? extractAnthropicText(response.json)
    : extractOpenAiText(response.json);
  if (!text) {
    throw new AiProviderError(
      `${providerDisplayName(input.provider)} 返回了空结果`,
      response.status,
    );
  }
  return text;
}
