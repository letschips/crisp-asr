import { requestUrl } from "obsidian";
import {
  AsrServiceError,
  isRetryableHttpStatus,
  toAsrServiceError,
} from "./service-error";

const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

export const GEMINI_TTS_MODELS = [
  ["gemini-3.8-flash-lite-tts", "Gemini 3.8 Flash-Lite TTS（快、便宜，适合朗读）"],
  ["gemini-3.8-flash-tts", "Gemini 3.8 Flash TTS（音质和表现力更好）"],
] as const;

export type GeminiTtsModel = typeof GEMINI_TTS_MODELS[number][0];

/** 官方 30 个预置音色（speech-generation 文档，2026-09-24 版）。 */
export const GEMINI_TTS_VOICES = [
  ["Kore", "Firm"], ["Puck", "Upbeat"], ["Charon", "Informative"],
  ["Zephyr", "Bright"], ["Fenrir", "Excitable"], ["Leda", "Youthful"],
  ["Orus", "Firm"], ["Aoede", "Breezy"], ["Callirrhoe", "Easy-going"],
  ["Autonoe", "Bright"], ["Enceladus", "Breathy"], ["Iapetus", "Clear"],
  ["Umbriel", "Easy-going"], ["Algieba", "Smooth"], ["Despina", "Smooth"],
  ["Erinome", "Clear"], ["Algenib", "Gravelly"], ["Rasalgethi", "Informative"],
  ["Laomedeia", "Upbeat"], ["Achernar", "Soft"], ["Alnilam", "Firm"],
  ["Schedar", "Even"], ["Gacrux", "Mature"], ["Pulcherrima", "Forward"],
  ["Achird", "Friendly"], ["Zubenelgenubi", "Casual"], ["Vindemiatrix", "Gentle"],
  ["Sadachbia", "Lively"], ["Sadaltager", "Knowledgeable"], ["Sulafat", "Warm"],
] as const;

export interface GeminiTtsOptions {
  model: GeminiTtsModel;
  voice: string;
  style: string;
}

interface TtsTextContent {
  type: "text";
  text: string;
  annotations?: Array<{ type: "speech_metadata"; style: string }>;
}

export interface GeminiTtsBody {
  model: string;
  input: Array<{ type: "user_input"; content: TtsTextContent[] }>;
  response_format: { type: "audio" };
  generation_config: { speech_config: Array<{ voice: string }> };
}

export interface GeminiTtsResult {
  audio: ArrayBuffer;
  mimeType: string;
}

export function buildGeminiTtsBody(text: string, options: GeminiTtsOptions): GeminiTtsBody {
  const content: TtsTextContent = { type: "text", text };
  const style = options.style.trim();
  if (style) content.annotations = [{ type: "speech_metadata", style }];
  return {
    model: options.model,
    input: [{ type: "user_input", content: [content] }],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice: options.voice }] },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function base64ToArrayBuffer(data: string): ArrayBuffer {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function parseGeminiTtsResponse(json: unknown, status: number): GeminiTtsResult {
  const root = asRecord(json);
  if (root.error || status < 200 || status >= 300) {
    const error = asRecord(root.error);
    const message = typeof error.message === "string" ? error.message : `HTTP ${status}`;
    throw new AsrServiceError(`Gemini 朗读失败: ${message}`, isRetryableHttpStatus(status), {
      code: String(error.code ?? status),
    });
  }
  let last: Record<string, unknown> | null = null;
  for (const step of Array.isArray(root.steps) ? root.steps : []) {
    const content = asRecord(step).content;
    for (const item of Array.isArray(content) ? content : []) {
      const record = asRecord(item);
      if (record.type === "audio" && typeof record.data === "string" && record.data) {
        last = record;
      }
    }
  }
  if (!last) {
    throw new AsrServiceError("Gemini 朗读失败: 接口没有返回音频", false);
  }
  return {
    audio: base64ToArrayBuffer(last.data as string),
    mimeType: typeof last.mime_type === "string" ? last.mime_type : "audio/wav",
  };
}

export async function synthesizeGeminiSpeech(
  apiKey: string,
  text: string,
  options: GeminiTtsOptions,
): Promise<GeminiTtsResult> {
  let response;
  try {
    response = await requestUrl({
      url: INTERACTIONS_URL,
      method: "POST",
      throw: false,
      headers: {
        "x-goog-api-key": apiKey.trim(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildGeminiTtsBody(text, options)),
    });
  } catch (error) {
    throw toAsrServiceError(error, true);
  }
  let json: unknown;
  try {
    json = response.json;
  } catch {
    json = {};
  }
  return parseGeminiTtsResponse(json, response.status);
}
