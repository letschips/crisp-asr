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

  takePending(): Uint8Array | null {
    const pending = this.pending;
    this.pending = null;
    return pending;
  }
}

export interface DoubaoStreamingClientOptions {
  apiKey: string;
  resourceId: string;
  onPayload: (payload: unknown) => void;
  onError: (error: Error) => void;
  onLogId?: (logId: string) => void;
  onReconnecting?: () => void;
  onReconnected?: () => void;
  recognition?: import("./recognition-context").RecognitionEnhancement;
}

const STREAM_URL =
  "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async";

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAYS = [1_000, 2_000, 4_000];
const MAX_RECONNECT_AUDIO_PACKETS = 600;

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
  private queue = new PendingAudioQueue();
  private finishPromise: Promise<void> | null = null;
  private resolveFinish: (() => void) | null = null;
  private finishTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;
  private dead = false;
  private reconnecting = false;
  private reconnectAttempts = 0;
  private reconnectAudio: Uint8Array[] = [];

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
    let opened = false;
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
    socket.on("error", () => {
      if (
        opened
        && this.socket === socket
        && !this.closedByUser
        && this.finishPromise === null
      ) {
        socket.close();
      }
    });
    socket.on("close", () => {
      if (this.socket !== socket) {
        return;
      }
      const wasUnexpected = !this.closedByUser;
      const wasFinished = this.finishPromise !== null;
      this.socket = null;
      if (wasFinished || !wasUnexpected) {
        this.completeFinish();
        return;
      }
      if (opened) {
        this.handleUnexpectedClose();
      }
    });

    await new Promise<void>((resolve, reject) => {
      const connectTimeout = setTimeout(() => {
        socket.off("open", handleOpen);
        socket.off("error", handleInitialError);
        socket.close();
        reject(new Error("连接豆包 ASR 超时，请检查网络后重试"));
      }, 15_000);
      const handleOpen = (): void => {
        clearTimeout(connectTimeout);
        opened = true;
        socket.off("error", handleInitialError);
        socket.off("close", handleInitialClose);
        resolve();
      };
      const handleInitialError = (error: Error): void => {
        clearTimeout(connectTimeout);
        socket.off("open", handleOpen);
        socket.off("close", handleInitialClose);
        reject(error);
      };
      const handleInitialClose = (): void => {
        clearTimeout(connectTimeout);
        socket.off("open", handleOpen);
        socket.off("error", handleInitialError);
        reject(new Error("实时转写连接在建立前已断开"));
      };
      socket.once("open", handleOpen);
      socket.once("error", handleInitialError);
      socket.once("close", handleInitialClose);
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
        ...recognitionRequestFields(this.options.recognition, true),
      },
    }));
  }

  sendAudio(audio: Uint8Array): void {
    if (this.dead) {
      return;
    }
    if (this.reconnecting) {
      this.bufferReconnectAudio(audio);
      return;
    }
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const packet = this.queue.push(audio);
    if (packet) {
      this.socket.send(
        buildAudioRequest(packet.audio, packet.sequence, packet.final),
      );
    }
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnecting || this.dead || this.closedByUser) {
      return;
    }
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.dead = true;
      this.options.onError(
        new Error("实时转写连接已断开，自动重连失败"),
      );
      return;
    }
    this.reconnecting = true;
    this.reconnectAttempts += 1;
    this.options.onReconnecting?.();
    const delay = RECONNECT_DELAYS[
      Math.min(this.reconnectAttempts - 1, RECONNECT_DELAYS.length - 1)
    ];
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (this.dead || this.closedByUser) {
      this.reconnecting = false;
      return;
    }
    try {
      this.socket = null;
      this.queue = new PendingAudioQueue();
      this.closedByUser = false;
      this.finishPromise = null;
      this.resolveFinish = null;
      this.finishTimer = null;
      await this.connect();
      const reconnectedSocket = this.socket as WebSocket | null;
      if (!reconnectedSocket || reconnectedSocket.readyState !== WebSocket.OPEN) {
        throw new Error("实时转写重连未能保持连接");
      }
      this.reconnecting = false;
      this.reconnectAttempts = 0;
      const bufferedAudio = this.reconnectAudio.splice(0);
      for (const audio of bufferedAudio) {
        this.sendAudio(audio);
      }
      this.options.onReconnected?.();
    } catch {
      this.reconnecting = false;
      if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        this.dead = true;
        this.options.onError(
          new Error("实时转写连接已断开，自动重连失败"),
        );
      } else {
        void this.attemptReconnect();
      }
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
        this.options.onError(new Error("转写收尾超时，末尾内容可能不完整"));
        this.completeFinish();
      }, 5_000);
    });
    return this.finishPromise;
  }

  close(): void {
    this.closedByUser = true;
    this.reconnectAudio = [];
    this.completeFinish();
  }

  private handleUnexpectedClose(): void {
    const pending = this.queue.takePending();
    if (pending) {
      this.reconnectAudio.unshift(pending);
    }
    this.closedByUser = false;
    if (!this.dead && !this.reconnecting) {
      void this.attemptReconnect();
    }
  }

  private bufferReconnectAudio(audio: Uint8Array): void {
    this.reconnectAudio.push(audio.slice());
    if (this.reconnectAudio.length > MAX_RECONNECT_AUDIO_PACKETS) {
      this.reconnectAudio.splice(
        0,
        this.reconnectAudio.length - MAX_RECONNECT_AUDIO_PACKETS,
      );
    }
  }

  private completeFinish(): void {
    if (this.finishTimer) {
      clearTimeout(this.finishTimer);
      this.finishTimer = null;
    }
    this.closedByUser = true;
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
import { recognitionRequestFields } from "./recognition-context";
