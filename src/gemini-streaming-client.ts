import WebSocket, { type RawData } from "ws";
import { AsrServiceError } from "./service-error";

export interface GeminiStreamingClientOptions {
  apiKey: string;
  mode?: "smart" | "verbatim";
  customVocabulary?: string[];
  onPayload: (payload: unknown) => void;
  onError: (error: Error) => void;
  onLogId?: (logId: string) => void;
  onReconnecting?: () => void;
  onReconnected?: () => void;
}

const LIVE_WS_BASE =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAYS = [1_000, 2_000, 4_000];
const MAX_RECONNECT_AUDIO_PACKETS = 600;
const MAX_LIVE_AUDIO_CHUNK_BYTES = 3_200;

function rawDataToString(data: RawData): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
}

export class GeminiStreamingClient {
  private socket: WebSocket | null = null;
  private isSetupComplete = false;
  private setupResolve: (() => void) | null = null;
  private setupReject: ((error: Error) => void) | null = null;
  private setupTimer: ReturnType<typeof setTimeout> | null = null;
  private finishPromise: Promise<void> | null = null;
  private resolveFinish: (() => void) | null = null;
  private finishTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;
  private dead = false;
  private reconnecting = false;
  private reconnectAttempts = 0;
  private pendingAudioBuffer: Uint8Array[] = [];
  private currentTurnStartMs = 0;
  private elapsedMs = 0;

  constructor(private readonly options: GeminiStreamingClientOptions) {}

  async connect(): Promise<void> {
    if (this.socket) {
      throw new Error("实时转写连接已经存在");
    }

    const key = this.options.apiKey.trim();
    if (!key) {
      throw new AsrServiceError("Gemini API Key 不能为空", false, { code: "EMPTY_KEY" });
    }

    const wsUrl = `${LIVE_WS_BASE}?key=${encodeURIComponent(key)}`;
    const socket = new WebSocket(wsUrl);
    this.socket = socket;
    this.isSetupComplete = false;

    socket.on("message", (data) => {
      try {
        const text = rawDataToString(data);
        const json = JSON.parse(text) as Record<string, unknown>;
        this.handleServerMessage(json);
      } catch (error) {
        console.error("[Crisp ASR - Gemini Live] 消息处理异常:", error);
        this.options.onError(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });

    socket.on("error", (err) => {
      console.warn("[Crisp ASR - Gemini Live] Socket error:", err);
      if (
        this.isSetupComplete
        && this.socket === socket
        && !this.closedByUser
        && this.finishPromise === null
      ) {
        socket.close();
      }
    });

    socket.on("close", (code, reason) => {
      if (this.socket !== socket) {
        return;
      }
      const wasUnexpected = !this.closedByUser;
      const wasFinished = this.finishPromise !== null;
      const wasSetup = this.isSetupComplete;
      this.socket = null;
      this.isSetupComplete = false;

      if (wasFinished || !wasUnexpected) {
        this.completeFinish();
        return;
      }

      if (wasSetup) {
        this.handleUnexpectedClose();
      } else {
        const reasonStr = reason ? reason.toString("utf8") : "";
        const err = new AsrServiceError(
          `Gemini 实时连接建立失败 (${code}): ${reasonStr || "连接断开"}`,
          false,
          { code: String(code) },
        );
        this.setupReject?.(err);
        this.setupReject = null;
        this.setupResolve = null;
        this.options.onError(err);
      }
    });

    await new Promise<void>((resolve, reject) => {
      this.setupResolve = resolve;
      this.setupReject = reject;

      this.setupTimer = setTimeout(() => {
        socket.off("open", handleOpen);
        socket.off("error", handleInitialError);
        socket.off("close", handleInitialClose);
        if (this.socket === socket) {
          this.socket = null;
        }
        socket.close();
        const err = new Error("连接 Gemini Live ASR 超时，请检查网络后重试");
        this.setupResolve = null;
        this.setupReject = null;
        this.setupTimer = null;
        reject(err);
      }, 15_000);

      const handleOpen = (): void => {
        socket.off("error", handleInitialError);
        socket.off("close", handleInitialClose);
        try {
          this.sendSetup(socket);
        } catch (err) {
          this.clearSetupTimer();
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };

      const handleInitialError = (error: Error): void => {
        this.clearSetupTimer();
        socket.off("open", handleOpen);
        socket.off("close", handleInitialClose);
        reject(error);
      };

      const handleInitialClose = (): void => {
        this.clearSetupTimer();
        socket.off("open", handleOpen);
        socket.off("error", handleInitialError);
        reject(new Error("Gemini 实时转写连接在建立前已断开"));
      };

      socket.once("open", handleOpen);
      socket.once("error", handleInitialError);
      socket.once("close", handleInitialClose);
    });
  }

  private sendSetup(socket: WebSocket): void {
    const isSmart = this.options.mode !== "verbatim";
    const customVocabulary = this.options.customVocabulary?.slice(0, 1_000);

    const setupMsg: Record<string, unknown> = {
      setup: {
        model: "models/gemini-3.5-transcribe-live",
        generationConfig: {
          responseModalities: ["TEXT"],
        },
        inputAudioTranscription: {
          languageCodes: [],
          ...(customVocabulary?.length ? { customVocabulary } : {}),
          mode: isSmart ? "SMART" : "VERBATIM",
        },
      },
    };
    socket.send(JSON.stringify(setupMsg));
  }

  private handleServerMessage(json: Record<string, unknown>): void {
    // 1. Handle Setup Complete handshake
    if (json.setupComplete !== undefined || json.BidiGenerateContentSetupComplete !== undefined) {
      this.isSetupComplete = true;
      this.clearSetupTimer();
      if (this.setupResolve) {
        const resolve = this.setupResolve;
        this.setupResolve = null;
        this.setupReject = null;
        resolve();
      }
      this.flushPendingAudio();
      return;
    }

    // 2. Handle Server Error
    if (json.error) {
      const errorObj = json.error as Record<string, unknown>;
      const msg = typeof errorObj.message === "string" ? errorObj.message : "Gemini 实时转写错误";
      const code = String(errorObj.code || "");
      const err = new AsrServiceError(`Gemini 实时识别异常: ${msg}`, false, { code });
      if (this.setupReject) {
        const reject = this.setupReject;
        this.setupResolve = null;
        this.setupReject = null;
        this.clearSetupTimer();
        reject(err);
      }
      throw err;
    }

    // If server sent data before explicit setupComplete, acknowledge setup
    if (!this.isSetupComplete) {
      this.isSetupComplete = true;
      this.clearSetupTimer();
      if (this.setupResolve) {
        const resolve = this.setupResolve;
        this.setupResolve = null;
        this.setupReject = null;
        resolve();
      }
    }

    // 3. Handle Server Content & Transcripts
    const serverContent = json.serverContent as Record<string, unknown> | undefined;
    if (!serverContent) {
      return;
    }

    const interim = serverContent.interimInputTranscription as
      | Record<string, unknown>
      | undefined;
    const finalized = serverContent.inputTranscription as
      | Record<string, unknown>
      | undefined;
    const interimText = typeof interim?.text === "string"
      ? interim.text.trim()
      : "";
    const finalizedText = typeof finalized?.text === "string"
      ? finalized.text.trim()
      : "";
    const currentText = finalizedText || interimText;
    if (currentText) {
      const turnEndMs = Math.max(this.currentTurnStartMs + 500, this.elapsedMs);
      const payload = {
        result: {
          text: currentText,
          utterances: [
            {
              text: currentText,
              start_time: this.currentTurnStartMs,
              end_time: turnEndMs,
              definite: Boolean(finalizedText),
            },
          ],
        },
      };
      this.options.onPayload(payload);
    }

    if (finalizedText) {
      this.currentTurnStartMs = Math.max(this.currentTurnStartMs + 500, this.elapsedMs);
      if (this.finishPromise) {
        this.completeFinish();
      }
    }
  }

  sendAudio(audio: Uint8Array): void {
    if (this.dead) {
      return;
    }
    // Each 16kHz 16-bit mono PCM sample is 2 bytes -> 32 bytes per ms
    this.elapsedMs += Math.floor(audio.byteLength / 32);

    if (this.reconnecting || !this.isSetupComplete || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.bufferPendingAudio(audio);
      return;
    }

    this.sendMediaChunk(audio);
  }

  private sendMediaChunk(audio: Uint8Array): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    for (let offset = 0; offset < audio.byteLength; offset += MAX_LIVE_AUDIO_CHUNK_BYTES) {
      const chunk = audio.subarray(
        offset,
        Math.min(offset + MAX_LIVE_AUDIO_CHUNK_BYTES, audio.byteLength),
      );
      const msg = {
        realtimeInput: {
          audio: {
            mimeType: "audio/pcm;rate=16000",
            data: Buffer.from(chunk).toString("base64"),
          },
        },
      };
      try {
        this.socket.send(JSON.stringify(msg));
      } catch (err) {
        console.warn("[Crisp ASR - Gemini Live] 发送音频帧失败:", err);
        return;
      }
    }
  }

  private bufferPendingAudio(audio: Uint8Array): void {
    if (this.pendingAudioBuffer.length >= MAX_RECONNECT_AUDIO_PACKETS) {
      this.pendingAudioBuffer.shift();
    }
    this.pendingAudioBuffer.push(audio);
  }

  private flushPendingAudio(): void {
    if (this.pendingAudioBuffer.length === 0) return;
    const buffered = this.pendingAudioBuffer.splice(0);
    for (const chunk of buffered) {
      this.sendMediaChunk(chunk);
    }
  }

  private handleUnexpectedClose(): void {
    if (this.dead || this.closedByUser) {
      return;
    }
    void this.attemptReconnect();
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnecting || this.dead || this.closedByUser) {
      return;
    }
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.dead = true;
      this.options.onError(
        new Error("Gemini 实时转写连接已断开，自动重连失败"),
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
      this.isSetupComplete = false;
      this.closedByUser = false;
      this.finishPromise = null;
      this.resolveFinish = null;
      this.finishTimer = null;
      await this.connect();
      const reconnectedSocket = this.socket as WebSocket | null;
      if (!reconnectedSocket || reconnectedSocket.readyState !== WebSocket.OPEN) {
        throw new Error("Gemini 实时转写重连未能保持连接");
      }
      this.reconnecting = false;
      this.reconnectAttempts = 0;
      this.flushPendingAudio();
      this.options.onReconnected?.();
    } catch {
      this.reconnecting = false;
      if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        this.dead = true;
        this.options.onError(
          new Error("Gemini 实时转写连接已断开，自动重连失败"),
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

    // Flush any remaining audio
    this.flushPendingAudio();

    // Inform server of stream completion
    try {
      socket.send(JSON.stringify({
        realtimeInput: { audioStreamEnd: true },
      }));
    } catch {
      // socket might have closed
    }

    this.finishPromise = new Promise((resolve) => {
      this.resolveFinish = resolve;
      this.finishTimer = setTimeout(() => {
        this.completeFinish();
      }, 3_000);
    });
    return this.finishPromise;
  }

  private completeFinish(): void {
    if (this.finishTimer) {
      clearTimeout(this.finishTimer);
      this.finishTimer = null;
    }
    const resolve = this.resolveFinish;
    this.resolveFinish = null;
    this.finishPromise = null;
    resolve?.();
  }

  private clearSetupTimer(): void {
    if (this.setupTimer) {
      clearTimeout(this.setupTimer);
      this.setupTimer = null;
    }
  }

  close(): void {
    this.closedByUser = true;
    this.dead = true;
    this.isSetupComplete = false;
    this.clearSetupTimer();
    this.completeFinish();
    const socket = this.socket;
    this.socket = null;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      socket.close();
    }
  }
}
