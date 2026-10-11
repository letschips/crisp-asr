import type { AiProvider, AiThinking } from "./settings";

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
  /** DeepSeek only; other providers ignore it. Defaults to off. */
  thinking?: AiThinking;
  systemPrompt: string;
  userPrompt: string;
}

/** Current DeepSeek API model IDs (api-docs.deepseek.com, reviewed 2026-10-11). */
export const DEEPSEEK_MODELS: ReadonlyArray<readonly [string, string]> = [
  ["deepseek-flash", "DeepSeek V4.1 Flash（推荐）"],
  ["deepseek-v4-pro", "DeepSeek V4 Pro"],
];

export const DEFAULT_DEEPSEEK_MODEL = "deepseek-flash";

/** Retired or temporarily routed IDs that DeepSeek no longer serves as named. */
const RETIRED_DEEPSEEK_MODELS = new Set([
  "deepseek-chat",
  "deepseek-reasoner",
  "deepseek-v4-flash",
  "deepseek-v4-flash-vision-exp",
]);

/** Non-thinking replies default to 8K tokens, too short for a 12K-character chunk. */
const DEEPSEEK_NON_THINKING_MAX_TOKENS = 32_768;

export function normalizeDeepSeekModel(model: string): string {
  const trimmed = model.trim();
  return !trimmed || RETIRED_DEEPSEEK_MODELS.has(trimmed)
    ? DEFAULT_DEEPSEEK_MODEL
    : trimmed;
}

function deepSeekOptions(thinking: AiThinking | undefined): Record<string, unknown> {
  return !thinking || thinking === "off"
    ? {
      thinking: { type: "disabled" },
      max_tokens: DEEPSEEK_NON_THINKING_MAX_TOKENS,
    }
    : { thinking: { type: "enabled" }, reasoning_effort: thinking };
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
  const deepseek = input.provider === "deepseek";
  const model = deepseek
    ? normalizeDeepSeekModel(input.model)
    : input.model.trim();
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
        ...(deepseek ? deepSeekOptions(input.thinking) : {}),
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
    const hint = deepseek
      && (response.status === 400 || response.status === 404)
      && /model/i.test(detail)
      ? `；DeepSeek 可能已下线模型 ${model}，请在设置里改用 ${DEFAULT_DEEPSEEK_MODEL}`
      : "";
    throw new AiProviderError(
      `${providerDisplayName(input.provider)} 请求失败（${
        response.status
      }）：${detail}${hint}`,
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
