import { requestUrl } from "obsidian";
import type { FlashResponse } from "./flash-client";
import { pcm16PacketsToWav } from "./audio";
import type { TranscriptUtterance } from "./transcript";
import {
  AsrServiceError,
  isRetryableHttpStatus,
  toAsrServiceError,
} from "./service-error";

// 2026-11-19 docs: OpenAI-compatible chat/completions with input_audio; wav/mp3 only.
export const MIMO_BASE_URL = "https://api.xiaomimimo.com/v1";
export const MIMO_ASR_MODEL = "mimo-v2.5-asr";

const SAMPLE_RATE = 16_000;
/**
 * 2026-11-19 live test: a whole 165 s request silently dropped ~70% of the speech
 * (finish_reason "stop"), while 60 s pieces of the same audio came back complete.
 */
const MIN_SEGMENT_SECONDS = 45;
const MAX_SEGMENT_SECONDS = 90;
const QUIET_WINDOW_SECONDS = 0.2;
/** Complete Chinese transcripts ran ~3.6 chars/s; the truncated one ~1.0. */
const SUSPICIOUS_CHARS_PER_SECOND = 1.5;
const SUSPICIOUS_MIN_SECONDS = 20;
const CONCURRENCY = 3;

export interface MimoSegment {
  start: number;
  end: number;
}

export interface MimoTranscribeOptions {
  language?: "auto" | "zh" | "en";
}

/** Reads 16-bit PCM samples out of a WAV produced by decodeAudioToPcmWav. */
export function readPcm16Wav(wav: ArrayBuffer): Int16Array {
  const view = new DataView(wav);
  const tag = (offset: number): string => String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
  if (wav.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    throw new AsrServiceError("MiMo 转写需要 WAV 音频", false);
  }
  let offset = 12;
  while (offset + 8 <= wav.byteLength) {
    const size = view.getUint32(offset + 4, true);
    if (tag(offset) === "data") {
      const length = Math.min(size, wav.byteLength - offset - 8);
      return new Int16Array(wav.slice(offset + 8, offset + 8 + (length & ~1)));
    }
    offset += 8 + size + (size & 1);
  }
  throw new AsrServiceError("WAV 音频缺少数据段", false);
}

/** Index of the quietest window start in [from, to), by mean absolute amplitude. */
function quietestPoint(samples: Int16Array, from: number, to: number): number {
  const window = Math.round(QUIET_WINDOW_SECONDS * SAMPLE_RATE);
  if (to - from <= window) return Math.round((from + to) / 2);
  let sum = 0;
  for (let index = from; index < from + window; index += 1) sum += Math.abs(samples[index]);
  let best = sum;
  let bestStart = from;
  for (let start = from + 1; start + window <= to; start += 1) {
    sum += Math.abs(samples[start + window - 1]) - Math.abs(samples[start - 1]);
    if (sum < best) {
      best = sum;
      bestStart = start;
    }
  }
  return bestStart + Math.floor(window / 2);
}

/** Splits audio into 45–90 s pieces, cutting at the quietest moment in that range. */
export function planMimoSegments(samples: Int16Array): MimoSegment[] {
  const min = MIN_SEGMENT_SECONDS * SAMPLE_RATE;
  const max = MAX_SEGMENT_SECONDS * SAMPLE_RATE;
  const segments: MimoSegment[] = [];
  let start = 0;
  while (samples.length - start > max) {
    const end = quietestPoint(samples, start + min, start + max);
    segments.push({ start, end });
    start = end;
  }
  if (samples.length > start) segments.push({ start, end: samples.length });
  return segments;
}

function spokenLength(text: string): number {
  return text.replace(/[\s\p{P}\p{S}]/gu, "").length;
}

export function looksTruncated(text: string, seconds: number): boolean {
  return seconds >= SUSPICIOUS_MIN_SECONDS
    && spokenLength(text) / seconds < SUSPICIOUS_CHARS_PER_SECOND;
}

function segmentWav(samples: Int16Array, segment: MimoSegment): ArrayBuffer {
  const slice = samples.slice(segment.start, segment.end);
  return pcm16PacketsToWav([new Uint8Array(slice.buffer)], SAMPLE_RATE);
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function errorDetail(json: unknown, text: string): string {
  const error = (json as { error?: { message?: unknown } } | null)?.error;
  return typeof error?.message === "string" ? error.message : text.slice(0, 200);
}

async function requestSegment(
  apiKey: string,
  wav: ArrayBuffer,
  language: string,
): Promise<string> {
  let response;
  try {
    response = await requestUrl({
      url: `${MIMO_BASE_URL}/chat/completions`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: MIMO_ASR_MODEL,
        messages: [{
          role: "user",
          content: [{
            type: "input_audio",
            input_audio: { data: `data:audio/wav;base64,${toBase64(wav)}` },
          }],
        }],
        asr_options: { language },
      }),
      throw: false,
    });
  } catch (error) {
    throw toAsrServiceError(error, true);
  }
  let json: unknown = null;
  try {
    json = response.json;
  } catch {
    json = null;
  }
  if (response.status === 401) {
    throw new AsrServiceError("MiMo API Key 无效（按量付费 Key 以 sk- 开头）", false);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new AsrServiceError(
      `MiMo 转写失败（${response.status}）：${errorDetail(json, response.text ?? "")}`,
      isRetryableHttpStatus(response.status),
    );
  }
  const content = (json as { choices?: Array<{ message?: { content?: unknown } }> } | null)
    ?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content.trim() : "";
}

async function transcribeSegment(
  apiKey: string,
  samples: Int16Array,
  segment: MimoSegment,
  language: string,
): Promise<string> {
  const seconds = (segment.end - segment.start) / SAMPLE_RATE;
  const text = await requestSegment(apiKey, segmentWav(samples, segment), language);
  if (!looksTruncated(text, seconds)) return text;
  // Silently dropped speech: retry once as two halves cut at a pause, keep the longer result.
  const third = Math.floor((segment.end - segment.start) / 3);
  const middle = quietestPoint(samples, segment.start + third, segment.end - third);
  const halves = await Promise.all([
    requestSegment(apiKey, segmentWav(samples, { start: segment.start, end: middle }), language),
    requestSegment(apiKey, segmentWav(samples, { start: middle, end: segment.end }), language),
  ]);
  const retried = halves.filter(Boolean).join("");
  return spokenLength(retried) > spokenLength(text) ? retried : text;
}

export async function transcribeMimoFile(
  apiKey: string,
  wav: ArrayBuffer,
  options: MimoTranscribeOptions = {},
): Promise<FlashResponse> {
  const samples = readPcm16Wav(wav);
  const segments = planMimoSegments(samples);
  const language = options.language ?? "auto";
  const texts: string[] = new Array(segments.length).fill("");
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < segments.length) {
      const index = next;
      next += 1;
      texts[index] = await transcribeSegment(apiKey, samples, segments[index], language);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, segments.length) }, worker),
  );
  const utterances: TranscriptUtterance[] = segments
    .map((segment, index) => ({
      text: texts[index],
      start_time: Math.round(segment.start / SAMPLE_RATE * 1_000),
      end_time: Math.round(segment.end / SAMPLE_RATE * 1_000),
      definite: true,
    }))
    .filter((utterance) => utterance.text);
  const text = utterances.map((utterance) => utterance.text).join("\n");
  if (!text) throw new AsrServiceError("MiMo 服务返回了空结果", false);
  return { text, utterances };
}

export async function runMimoConnectionProbe(apiKey: string): Promise<void> {
  let response;
  try {
    response = await requestUrl({
      url: `${MIMO_BASE_URL}/models`,
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
      throw: false,
    });
  } catch (error) {
    throw toAsrServiceError(error, true);
  }
  if (response.status === 401) {
    throw new AsrServiceError("MiMo API Key 无效（按量付费 Key 以 sk- 开头）", false);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new AsrServiceError(`MiMo 连接失败（${response.status}）`, isRetryableHttpStatus(response.status));
  }
}
