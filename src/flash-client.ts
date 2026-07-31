import type { TranscriptUtterance } from "./transcript";
import { encodePcm16Wav } from "./audio";
import {
  AsrServiceError,
  isRetryableHttpStatus,
  isRetryableServiceCode,
} from "./service-error";

export interface FlashResponse {
  text: string;
  utterances: TranscriptUtterance[];
  logId?: string;
}

export async function runConnectionProbe(
  apiKey: string,
  transcribe: (
    apiKey: string,
    audio: ArrayBuffer,
  ) => Promise<FlashResponse>,
): Promise<void> {
  const silence = new Float32Array(1_600);
  try {
    await transcribe(apiKey, encodePcm16Wav(silence, 16_000));
  } catch (error) {
    const message = error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();
    if (
      message.includes("20000003")
      || message.includes("no speech")
      || message.includes("empty audio")
    ) {
      return;
    }
    throw error;
  }
}

export function buildFlashRequest(
  base64Audio: string,
  uid: string,
): unknown {
  return {
    user: { uid },
    audio: { data: base64Audio },
    request: {
      model_name: "bigmodel",
      enable_itn: true,
      enable_punc: true,
      enable_ddc: true,
      show_utterances: true,
    },
  };
}

function normalizedHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function parseFlashResponse(response: {
  status: number;
  headers: Record<string, string>;
  json: unknown;
}): FlashResponse {
  const headers = normalizedHeaders(response.headers);
  const serviceCode = headers["x-api-status-code"] ?? "";
  const logId = headers["x-tt-logid"];
  if (response.status < 200 || response.status >= 300 || serviceCode !== "20000000") {
    const message = headers["x-api-message"]
      ?? `HTTP ${response.status}`;
    const parts = [serviceCode || String(response.status), message];
    if (logId) {
      parts.push(`Log ID: ${logId}`);
    }
    throw new AsrServiceError(
      parts.join(" · "),
      isRetryableHttpStatus(response.status)
        || isRetryableServiceCode(serviceCode),
      { code: serviceCode || String(response.status) },
    );
  }

  const json = asRecord(response.json);
  const resultValue = Array.isArray(json.result)
    ? json.result[0]
    : json.result;
  const result = asRecord(resultValue);
  const text = typeof result.text === "string" ? result.text.trim() : "";
  const utterances = Array.isArray(result.utterances)
    ? result.utterances.map((candidate): TranscriptUtterance | null => {
      const item = asRecord(candidate);
      const utteranceText = typeof item.text === "string"
        ? item.text.trim()
        : "";
      if (utteranceText.length === 0) {
        return null;
      }
      return {
        text: utteranceText,
        start_time: typeof item.start_time === "number" ? item.start_time : 0,
        end_time: typeof item.end_time === "number" ? item.end_time : 0,
        definite: true,
      };
    }).filter((item): item is TranscriptUtterance => item !== null)
    : [];
  return { text, utterances, ...(logId ? { logId } : {}) };
}
