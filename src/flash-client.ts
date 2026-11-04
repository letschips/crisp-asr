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

// Volcengine took the flash (极速版) resource off its console for new accounts (docs, 2026-11-03).
const FLASH_ACCESS_HINT = "请检查豆包 API Key；新开通的账号已无法开通录音文件识别极速版，"
  + "电脑端会改用流式识别 2.0，手机端可在设置里改用 Gemini 转写，或联系火山引擎技术支持开通";

/** The flash resource rejected the key: not enabled for this account, or a bad key. */
export class FlashAccessError extends AsrServiceError {}

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
    if (
      response.status === 401
      || response.status === 403
      || /not granted|unauthori[sz]ed|forbidden|permission/i.test(message)
    ) {
      parts.push(FLASH_ACCESS_HINT);
      throw new FlashAccessError(parts.join(" · "), false, {
        code: serviceCode || String(response.status),
      });
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
