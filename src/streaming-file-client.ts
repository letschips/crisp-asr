import { safeRandomUUID } from "./platform-crypto";
import {
  type IWebSocket,
  createPlatformWebSocket,
  rawDataToBytes,
} from "./platform-websocket";
import {
  buildAudioRequest,
  buildFullClientRequest,
  parseServerFrame,
} from "./doubao-protocol";
import {
  recognitionRequestFields,
  type RecognitionEnhancement,
} from "./recognition-context";
import { extractTranscriptResult } from "./transcript";
import type { FlashResponse } from "./flash-client";
import { AsrServiceError } from "./service-error";

const STREAM_URL =
  "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async";

/**
 * Push speed relative to real time. Measured 2026-11-04 on a 7.6-minute recording
 * with second-pass recognition: 4x and 6x completed cleanly twice each, 8x and
 * unpaced pushes ended with 45000081 and lost text.
 */
export const STREAMING_FILE_SPEED = 6;
const CHUNK_MS = 200;
const BYTES_PER_MS = 32; // 16 kHz, 16-bit, mono
/** After a late timer, catch up by at most this much audio per wait. */
const MAX_BURST_MS = 10_000;
const OPEN_TIMEOUT_MS = 15_000;
const FINAL_TIMEOUT_MS = 60_000;

export interface StreamingFileOptions {
  apiKey: string;
  resourceId: string;
  /** Raw 16 kHz mono PCM16 (little-endian), no WAV header. */
  pcm: Uint8Array;
  recognition?: RecognitionEnhancement;
  createSocket?: (
    url: string,
    init: { headers: Record<string, string> },
  ) => IWebSocket;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Transcribe a whole recording through Doubao streaming ASR 2.0, for accounts that
 * cannot use the flash (极速版) resource. Desktop only: it needs custom WebSocket headers.
 */
export async function transcribePcmViaStreaming(
  options: StreamingFileOptions,
): Promise<FlashResponse> {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => Date.now());
  const createSocket = options.createSocket
    ?? ((url, init) => createPlatformWebSocket(url, init));
  const socket = createSocket(STREAM_URL, {
    headers: {
      "X-Api-Key": options.apiKey,
      "X-Api-Resource-Id": options.resourceId,
      "X-Api-Connect-Id": safeRandomUUID(),
      "X-Api-Sequence": "-1",
    },
  });
  socket.binaryType = "arraybuffer";

  let failure: Error | null = null;
  let lastPayload: unknown = null;
  let audioDone = false;
  let settle: ((error: Error | null) => void) | null = null;
  const outcome = new Promise<Error | null>((resolve) => {
    settle = (error) => {
      settle = null;
      resolve(error);
    };
  });
  const fail = (error: Error) => {
    failure = failure ?? error;
    settle?.(failure);
  };

  socket.on("message", (data: unknown) => {
    try {
      const frame = parseServerFrame(rawDataToBytes(data));
      if (frame.type === "error") {
        fail(new AsrServiceError(
          `豆包流式识别失败：${frame.code} · ${frame.message}`,
          false,
          { code: String(frame.code) },
        ));
        return;
      }
      lastPayload = frame.payload;
      if (frame.sequence !== null && frame.sequence < 0) settle?.(null);
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
  socket.on("unexpected-response", (_request: unknown, response: {
    statusCode?: number;
    headers?: Record<string, string | string[] | undefined>;
  }) => {
    const message = response.headers?.["x-api-message"];
    fail(new AsrServiceError(
      `豆包流式识别连接被拒绝：HTTP ${response.statusCode ?? "?"}${message ? ` · ${message}` : ""}`,
      false,
      { code: String(response.statusCode ?? "") },
    ));
  });
  socket.on("error", (error: unknown) => {
    fail(error instanceof Error ? error : new Error(String(error)));
  });
  // The server sends its last result and then closes the socket; it does not
  // reliably mark a final frame (observed 2026-11-04).
  socket.on("close", (event: unknown) => {
    const code = typeof event === "number"
      ? event
      : (event as { code?: unknown } | null)?.code;
    const clean = typeof code !== "number" || code === 1000;
    if (audioDone && clean && !failure) {
      settle?.(null);
      return;
    }
    fail(new AsrServiceError("豆包流式识别连接在返回最终结果前断开", true));
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new AsrServiceError("豆包流式识别连接超时", true));
      }, OPEN_TIMEOUT_MS);
      socket.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      void outcome.then((error) => {
        clearTimeout(timer);
        if (error) reject(error);
      });
    });

    socket.send(buildFullClientRequest({
      user: { uid: "crisp-asr-desktop" },
      audio: {
        format: "pcm",
        codec: "raw",
        rate: 16_000,
        bits: 16,
        channel: 1,
        language: "zh-CN",
      },
      request: {
        model_name: "bigmodel",
        enable_itn: true,
        enable_punc: true,
        enable_ddc: true,
        show_utterances: true,
        result_type: "full",
        ...recognitionRequestFields(options.recognition, true),
        // Without the second pass, faster-than-real-time audio comes back as
        // one- or two-word fragments.
        enable_nonstream: true,
      },
    }));

    const chunkBytes = CHUNK_MS * BYTES_PER_MS;
    const chunkCount = Math.max(1, Math.ceil(options.pcm.length / chunkBytes));
    const maxBurst = MAX_BURST_MS / CHUNK_MS;
    let sent = 0;
    let budgetStart = now();
    let budgetSent = 0;
    while (sent < chunkCount && !failure) {
      // Send what is due at STREAMING_FILE_SPEED, but never more than MAX_BURST_MS of audio at once.
      const due = Math.floor(((now() - budgetStart) * STREAMING_FILE_SPEED) / CHUNK_MS) + 1;
      let burst = Math.min(due - budgetSent, maxBurst, chunkCount - sent);
      if (burst >= maxBurst) {
        // Fell behind (late timer): restart the pace from here instead of bursting.
        budgetStart = now();
        budgetSent = 0;
      }
      burst = Math.max(burst, 0);
      for (let index = 0; index < burst; index += 1) {
        const final = sent === chunkCount - 1;
        socket.send(buildAudioRequest(
          options.pcm.subarray(sent * chunkBytes, (sent + 1) * chunkBytes),
          sent + 2,
          final,
        ));
        sent += 1;
        budgetSent += 1;
      }
      if (sent === chunkCount) audioDone = true;
      if (sent < chunkCount) {
        await sleep(CHUNK_MS / STREAMING_FILE_SPEED);
      }
    }
    if (failure) throw failure;

    const finalTimer = setTimeout(() => {
      fail(new AsrServiceError("豆包流式识别等待最终结果超时", true));
    }, FINAL_TIMEOUT_MS);
    const error = await outcome;
    clearTimeout(finalTimer);
    if (error) throw error;
  } finally {
    settle = null;
    try {
      socket.close();
    } catch {
      // Already closed.
    }
  }

  const extracted = extractTranscriptResult(lastPayload);
  const additions = (lastPayload as { result?: { additions?: { log_id?: unknown } } } | null)
    ?.result?.additions;
  const logId = typeof additions?.log_id === "string" ? additions.log_id : undefined;
  return {
    text: extracted.text,
    utterances: (extracted.utterances ?? []).map((utterance) => ({
      ...utterance,
      definite: true,
    })),
    ...(logId ? { logId } : {}),
  };
}
