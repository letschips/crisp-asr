import { extractTranscriptResult, type TranscriptUtterance } from "./transcript";
import { encodePcm16Wav } from "./audio";
import {
  AsrServiceError,
  isRetryableHttpStatus,
  isRetryableServiceCode,
} from "./service-error";
import {
  recognitionRequestFields,
  type RecognitionEnhancement,
} from "./recognition-context";

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
  recognition?: RecognitionEnhancement,
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
      ...recognitionRequestFields(recognition, false),
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

  const extracted = extractTranscriptResult(response.json);
  const text = extracted.text;
  const utterances = (extracted.utterances ?? []).map((utterance) => ({
    ...utterance,
    definite: true,
  }));
  return { text, utterances, ...(logId ? { logId } : {}) };
}
