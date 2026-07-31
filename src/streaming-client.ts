export interface QueuedAudioPacket {
  audio: Uint8Array;
  sequence: number;
  final: boolean;
}

export class PendingAudioQueue {
  private pending: Uint8Array | null = null;
  private sequence = 1;
  private finished = false;

  push(audio: Uint8Array): QueuedAudioPacket | null {
    if (this.finished) {
      throw new Error("实时转写已经结束");
    }
    const previous = this.pending;
    this.pending = audio.slice();
    if (!previous) {
      return null;
    }
    this.sequence += 1;
    return {
      audio: previous,
      sequence: this.sequence,
      final: false,
    };
  }

  finish(): QueuedAudioPacket {
    if (this.finished) {
      throw new Error("实时转写已经结束");
    }
    this.finished = true;
    this.sequence += 1;
    return {
      audio: this.pending ?? new Uint8Array(),
      sequence: this.sequence,
      final: true,
    };
  }
}

export interface DoubaoStreamingClientOptions {
  apiKey: string;
  resourceId: string;
  onPayload: (payload: unknown) => void;
  onError: (error: Error) => void;
  onLogId?: (logId: string) => void;
}

const STREAM_URL =
  "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async";

function rawDataToBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) {
    return new Uint8Array(Buffer.concat(data));
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

export class DoubaoStreamingClient {
  private socket: WebSocket | null = null;
  private readonly queue = new PendingAudioQueue();
  private finishPromise: Promise<void> | null = null;
  private resolveFinish: (() => void) | null = null;
  private finishTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: DoubaoStreamingClientOptions) {}

  async connect(): Promise<void> {
    if (this.socket) {
      throw new Error("实时转写连接已经存在");
    }
    const socket = new WebSocket(STREAM_URL, {
      headers: {
        "X-Api-Key": this.options.apiKey,
        "X-Api-Resource-Id": this.options.resourceId,
        "X-Api-Connect-Id": randomUUID(),
        "X-Api-Sequence": "-1",
      },
    });
    this.socket = socket;
    socket.binaryType = "arraybuffer";
    socket.on("upgrade", (response) => {
      const value = response.headers["x-tt-logid"];
      const logId = Array.isArray(value) ? value[0] : value;
      if (logId) {
        this.options.onLogId?.(logId);
      }
    });
    socket.on("message", (data) => {
      try {
        const parsed = parseServerFrame(rawDataToBytes(data));
        if (parsed.type === "error") {
          throw new Error(
            `豆包实时识别失败：${parsed.code} · ${parsed.message}`,
          );
        }
        this.options.onPayload(parsed.payload);
        if (parsed.sequence !== null && parsed.sequence < 0) {
          this.completeFinish();
        }
      } catch (error) {
        this.options.onError(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });
    socket.on("error", (error) => {
      this.options.onError(
        error instanceof Error ? error : new Error(String(error)),
      );
    });
    socket.on("close", () => {
      this.completeFinish();
      this.socket = null;
    });

    await new Promise<void>((resolve, reject) => {
      const handleOpen = (): void => {
        socket.off("error", handleInitialError);
        resolve();
      };
      const handleInitialError = (error: Error): void => {
        socket.off("open", handleOpen);
        reject(error);
      };
      socket.once("open", handleOpen);
      socket.once("error", handleInitialError);
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
      },
    }));
  }

  sendAudio(audio: Uint8Array): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("实时转写尚未连接");
    }
    const packet = this.queue.push(audio);
    if (packet) {
      this.socket.send(
        buildAudioRequest(packet.audio, packet.sequence, packet.final),
      );
    }
  }

  finish(): Promise<void> {
    if (this.finishPromise) {
      return this.finishPromise;
    }
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.resolve();
    }
    const packet = this.queue.finish();
    socket.send(buildAudioRequest(packet.audio, packet.sequence, true));
    this.finishPromise = new Promise((resolve) => {
      this.resolveFinish = resolve;
      this.finishTimer = setTimeout(() => {
        this.completeFinish();
      }, 5_000);
    });
    return this.finishPromise;
  }

  close(): void {
    this.completeFinish();
  }

  private completeFinish(): void {
    if (this.finishTimer) {
      clearTimeout(this.finishTimer);
      this.finishTimer = null;
    }
    const socket = this.socket;
    if (
      socket
      && (
        socket.readyState === WebSocket.OPEN
        || socket.readyState === WebSocket.CONNECTING
      )
    ) {
      socket.close();
    }
    this.socket = null;
    this.resolveFinish?.();
    this.resolveFinish = null;
  }
}
import { randomUUID } from "node:crypto";
import WebSocket, { type RawData } from "ws";
import {
  buildAudioRequest,
  buildFullClientRequest,
  parseServerFrame,
} from "./doubao-protocol";
