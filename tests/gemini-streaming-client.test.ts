import WebSocket from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiStreamingClient } from "../src/gemini-streaming-client";

describe("GeminiStreamingClient", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function createClient(onPayload = vi.fn(), onError = vi.fn()): GeminiStreamingClient {
    return new GeminiStreamingClient({
      apiKey: "test-gemini-key",
      mode: "smart",
      onPayload,
      onError,
    });
  }

  it("buffers audio packets captured while in reconnecting state", () => {
    const client = createClient();
    const internal = client as unknown as {
      reconnecting: boolean;
      pendingAudioBuffer: Uint8Array[];
    };
    internal.reconnecting = true;

    client.sendAudio(new Uint8Array([10, 20]));
    client.sendAudio(new Uint8Array([30, 40]));

    expect(internal.pendingAudioBuffer).toEqual([
      new Uint8Array([10, 20]),
      new Uint8Array([30, 40]),
    ]);
  });

  it("sends the documented Live Transcribe setup configuration", () => {
    const client = new GeminiStreamingClient({
      apiKey: "test-gemini-key",
      mode: "smart",
      customVocabulary: ["Obsidian", "Crisp ASR"],
      onPayload: vi.fn(),
      onError: vi.fn(),
    });
    const send = vi.fn();
    const internal = client as unknown as {
      sendSetup(socket: { send: (value: string) => void }): void;
    };

    internal.sendSetup({ send });

    expect(JSON.parse(send.mock.calls[0][0] as string)).toEqual({
      setup: {
        model: "models/gemini-3.5-transcribe-live",
        generationConfig: { responseModalities: ["TEXT"] },
        inputAudioTranscription: {
          languageCodes: [],
          customVocabulary: ["Obsidian", "Crisp ASR"],
          mode: "SMART",
        },
      },
    });
  });

  it("sends PCM through the documented realtimeInput.audio field", () => {
    const client = createClient();
    const send = vi.fn();
    const close = vi.fn();
    const internal = client as unknown as {
      socket: {
        readyState: number;
        send: (value: string) => void;
        close: () => void;
      };
      isSetupComplete: boolean;
    };
    internal.socket = { readyState: WebSocket.OPEN, send, close };
    internal.isSetupComplete = true;

    client.sendAudio(new Uint8Array([1, 2, 3, 4]));

    expect(JSON.parse(send.mock.calls[0][0] as string)).toEqual({
      realtimeInput: {
        audio: {
          data: "AQIDBA==",
          mimeType: "audio/pcm;rate=16000",
        },
      },
    });
  });

  it("splits 200 ms mixer packets into at most 100 ms Gemini chunks", () => {
    const client = createClient();
    const send = vi.fn();
    const internal = client as unknown as {
      socket: {
        readyState: number;
        send: (value: string) => void;
        close: () => void;
      };
      isSetupComplete: boolean;
    };
    internal.socket = { readyState: WebSocket.OPEN, send, close: vi.fn() };
    internal.isSetupComplete = true;

    client.sendAudio(new Uint8Array(6_400));

    expect(send).toHaveBeenCalledTimes(2);
    for (const [raw] of send.mock.calls) {
      const message = JSON.parse(raw as string) as {
        realtimeInput: { audio: { data: string } };
      };
      expect(Buffer.from(message.realtimeInput.audio.data, "base64")).toHaveLength(3_200);
    }
  });

  it("processes official interim and finalized input transcription events", () => {
    const onPayload = vi.fn();
    const client = createClient(onPayload);
    const internal = client as unknown as {
      handleServerMessage(json: Record<string, unknown>): void;
    };

    internal.handleServerMessage({
      serverContent: {
        interimInputTranscription: { text: "实时" },
      },
    });

    expect(onPayload).toHaveBeenCalledWith({
      result: {
        text: "实时",
        utterances: [
          {
            text: "实时",
            start_time: 0,
            end_time: 500,
            definite: false,
          },
        ],
      },
    });

    internal.handleServerMessage({
      serverContent: {
        inputTranscription: { text: "实时转写测试" },
      },
    });

    expect(onPayload).toHaveBeenLastCalledWith({
      result: {
        text: "实时转写测试",
        utterances: [
          {
            text: "实时转写测试",
            start_time: 0,
            end_time: 500,
            definite: true,
          },
        ],
      },
    });
  });

  it("signals audio stream end and resolves when the final transcript arrives", async () => {
    vi.useFakeTimers();
    const client = createClient();
    const send = vi.fn();
    const close = vi.fn();
    const internal = client as unknown as {
      socket: {
        readyState: number;
        send: (value: string) => void;
        close: () => void;
      };
      isSetupComplete: boolean;
      handleServerMessage(json: Record<string, unknown>): void;
    };
    internal.socket = { readyState: WebSocket.OPEN, send, close };
    internal.isSetupComplete = true;

    const finishing = client.finish();
    expect(JSON.parse(send.mock.calls[0][0] as string)).toEqual({
      realtimeInput: { audioStreamEnd: true },
    });

    internal.handleServerMessage({
      serverContent: { inputTranscription: { text: "完成" } },
    });
    await expect(finishing).resolves.toBeUndefined();
    client.close();
  });

  it("clears the setup timeout after the handshake completes", () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const client = createClient();
    const timer = setTimeout(() => undefined, 15_000);
    const internal = client as unknown as {
      setupTimer: ReturnType<typeof setTimeout> | null;
      setupResolve: (() => void) | null;
      handleServerMessage(json: Record<string, unknown>): void;
    };
    internal.setupTimer = timer;
    internal.setupResolve = vi.fn();

    internal.handleServerMessage({ setupComplete: {} });

    expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
    expect(internal.setupTimer).toBeNull();
  });

  it("surfaces server error through onError callback", () => {
    const onError = vi.fn();
    const client = createClient(vi.fn(), onError);
    const internal = client as unknown as {
      handleServerMessage(json: Record<string, unknown>): void;
    };

    expect(() => {
      internal.handleServerMessage({
        error: {
          code: 400,
          message: "Invalid model specification",
        },
      });
    }).toThrowError("Gemini 实时识别异常: Invalid model specification");
  });

  it("handles unexpected close by attempting reconnect", () => {
    const client = createClient();
    const internal = client as unknown as {
      closedByUser: boolean;
      attemptReconnect: ReturnType<typeof vi.fn>;
      handleUnexpectedClose(): void;
    };
    internal.closedByUser = false;
    internal.attemptReconnect = vi.fn();

    internal.handleUnexpectedClose();

    expect(internal.attemptReconnect).toHaveBeenCalledOnce();
  });
});
