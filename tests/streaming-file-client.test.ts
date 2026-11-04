import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { IWebSocket } from "../src/platform-websocket";
import {
  STREAMING_FILE_SPEED,
  transcribePcmViaStreaming,
} from "../src/streaming-file-client";

type Listener = (...args: any[]) => void;

class FakeSocket implements IWebSocket {
  readyState = 0;
  binaryType = "arraybuffer";
  sent: Uint8Array[] = [];
  private listeners = new Map<string, Listener[]>();
  constructor(readonly url: string, readonly headers: Record<string, string>) {}
  send(data: any): void { this.sent.push(new Uint8Array(data)); }
  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close", 1000);
  }
  on(event: string, listener: Listener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }
  once(event: string, listener: Listener): this {
    const wrapped: Listener = (...args) => { this.off(event, wrapped); listener(...args); };
    return this.on(event, wrapped);
  }
  off(event: string, listener: Listener): this {
    this.listeners.set(event, (this.listeners.get(event) ?? []).filter((l) => l !== listener));
    return this;
  }
  emit(event: string, ...args: any[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
  }
  open(): void { this.readyState = 1; this.emit("open"); }
}

function resultFrame(sequence: number, payload: unknown): Uint8Array {
  const body = gzipSync(JSON.stringify(payload));
  const frame = new Uint8Array(12 + body.length);
  frame.set([0x11, 0x91, 0x11, 0x00], 0);
  const view = new DataView(frame.buffer);
  view.setInt32(4, sequence, false);
  view.setUint32(8, body.length, false);
  frame.set(body, 12);
  return frame;
}

function errorFrame(code: number, message: string): Uint8Array {
  const text = new TextEncoder().encode(message);
  const frame = new Uint8Array(12 + text.length);
  frame.set([0x11, 0xf0, 0x10, 0x00], 0);
  const view = new DataView(frame.buffer);
  view.setUint32(4, code, false);
  view.setUint32(8, text.length, false);
  frame.set(text, 12);
  return frame;
}

function sequenceOf(frame: Uint8Array): number {
  return new DataView(frame.buffer, frame.byteOffset).getInt32(4, false);
}

/** 1 second of 16 kHz mono PCM16 = 32 000 bytes = five 200 ms packets. */
const ONE_SECOND = new Uint8Array(32_000);

function setup(onAudioDone: (socket: FakeSocket) => void) {
  let socket: FakeSocket | null = null;
  const slept: number[] = [];
  let clock = 0;
  const options = {
    createSocket: (url: string, init: { headers: Record<string, string> }) => {
      socket = new FakeSocket(url, init.headers);
      queueMicrotask(() => socket!.open());
      return socket;
    },
    sleep: async (ms: number) => { slept.push(ms); clock += ms; },
    now: () => clock,
  };
  const watch = async () => {
    // Let the client send everything, then let the test reply.
    while (!socket || !socket.sent.some((f) => f[1] === 0x23)) {
      await new Promise((r) => setTimeout(r, 0));
    }
    onAudioDone(socket);
  };
  return { options, slept, socket: () => socket!, watch };
}

describe("transcribePcmViaStreaming", () => {
  it("pushes paced audio with second-pass recognition and returns the final transcript", async () => {
    const harness = setup((socket) => {
      socket.emit("message", resultFrame(-7, {
        result: {
          text: "你好。",
          utterances: [{ text: "你好。", start_time: 0, end_time: 900, definite: true }],
          additions: { log_id: "log-1" },
        },
      }));
    });
    const done = transcribePcmViaStreaming({
      apiKey: "key",
      resourceId: "volc.seedasr.sauc.duration",
      pcm: ONE_SECOND,
      recognition: { enableSpeakerInfo: true },
      ...harness.options,
    });
    await harness.watch();
    const result = await done;

    const socket = harness.socket();
    expect(socket.url).toBe("wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async");
    expect(socket.headers).toMatchObject({
      "X-Api-Key": "key",
      "X-Api-Resource-Id": "volc.seedasr.sauc.duration",
    });
    const request = JSON.parse(gunzipSync(socket.sent[0].slice(8)).toString("utf8"));
    expect(request.request).toMatchObject({
      enable_nonstream: true,
      show_utterances: true,
      enable_speaker_info: true,
    });
    const audio = socket.sent.slice(1);
    expect(audio).toHaveLength(5);
    expect(audio.map(sequenceOf)).toEqual([2, 3, 4, 5, -6]);
    // Five 200 ms packets at STREAMING_FILE_SPEED: four waits, none after the last packet.
    const waited = harness.slept.reduce((a, b) => a + b, 0);
    expect(waited).toBeCloseTo(800 / STREAMING_FILE_SPEED, 0);
    expect(result).toEqual({
      text: "你好。",
      utterances: [{ text: "你好。", start_time: 0, end_time: 900, definite: true }],
      logId: "log-1",
    });
  });

  it("rejects with the server error instead of returning a partial transcript", async () => {
    const harness = setup((socket) => {
      socket.emit("message", resultFrame(3, { result: { text: "前半段" } }));
      socket.emit("message", errorFrame(45000081, "Timed out waiting for the next audio packet"));
    });
    const done = transcribePcmViaStreaming({
      apiKey: "key", resourceId: "r", pcm: ONE_SECOND, ...harness.options,
    });
    await harness.watch();
    await expect(done).rejects.toThrow(/45000081/);
  });

  it("treats a clean close after all audio as the end of the result (the server's real behavior)", async () => {
    const harness = setup((socket) => {
      socket.emit("message", resultFrame(6, {
        result: { text: "全文。", utterances: [{ text: "全文。", start_time: 0, end_time: 1000 }] },
      }));
      socket.close();
    });
    const done = transcribePcmViaStreaming({
      apiKey: "key", resourceId: "r", pcm: ONE_SECOND, ...harness.options,
    });
    await harness.watch();
    await expect(done).resolves.toMatchObject({ text: "全文。" });
  });

  it("rejects when the socket closes before all audio was sent", async () => {
    let socket: FakeSocket | null = null;
    const done = transcribePcmViaStreaming({
      apiKey: "key",
      resourceId: "r",
      pcm: ONE_SECOND,
      createSocket: (url, init) => {
        socket = new FakeSocket(url, init.headers);
        const send = socket.send.bind(socket);
        socket.send = (data: any) => {
          send(data);
          if (socket!.sent.length === 2) socket!.close();
        };
        queueMicrotask(() => socket!.open());
        return socket;
      },
      sleep: async () => undefined,
    });
    await expect(done).rejects.toThrow(/断开/);
  });

  it("never bursts more than ten seconds of audio after a delayed timer", async () => {
    let socket: FakeSocket | null = null;
    let clock = 0;
    let first = true;
    let lastCount = 0;
    const bursts: number[] = [];
    const done = transcribePcmViaStreaming({
      apiKey: "key",
      resourceId: "r",
      pcm: new Uint8Array(32_000 * 120),
      createSocket: (url, init) => {
        socket = new FakeSocket(url, init.headers);
        queueMicrotask(() => socket!.open());
        return socket;
      },
      // The first wait oversleeps by a minute, as a throttled background timer would.
      sleep: async (ms) => {
        bursts.push(socket!.sent.length - lastCount);
        lastCount = socket!.sent.length;
        clock += first ? 60_000 : ms;
        first = false;
      },
      now: () => clock,
    });
    while (!socket || !(socket as FakeSocket).sent.some((f) => f[1] === 0x23)) {
      await new Promise((r) => setTimeout(r, 0));
    }
    (socket as unknown as FakeSocket).emit("message", resultFrame(-1, { result: { text: "" } }));
    await done;
    // 200 ms packets: 50 packets = 10 s of audio between two waits at most.
    expect(Math.max(...bursts)).toBeLessThanOrEqual(50);
    expect(bursts.length).toBeGreaterThan(5);
  });
});
