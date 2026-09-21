import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPlatformWebSocket,
  rawDataToBytes,
  rawDataToString,
} from "../src/platform-websocket";

class FakeNativeWebSocket {
  readyState = 0;
  binaryType = "blob";
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly sent: unknown[] = [];
  readonly closes: Array<{ code?: number; reason?: string }> = [];

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  message(data: unknown): void {
    this.onmessage?.({ data });
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
    this.readyState = 3;
    this.onclose?.({ code: code ?? 1000, reason: reason ?? "" });
  }

  send(data: unknown): void {
    this.sent.push(data);
  }
}

const originalWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

function installNativeWebSocket(): {
  instances: FakeNativeWebSocket[];
  WebSocket: new (url: string) => FakeNativeWebSocket;
} {
  const instances: FakeNativeWebSocket[] = [];
  class InstalledFakeWebSocket extends FakeNativeWebSocket {
    constructor(_url: string) {
      super();
      instances.push(this);
    }
  }
  (globalThis as { window?: unknown }).window = {
    WebSocket: InstalledFakeWebSocket,
  };
  return { instances, WebSocket: InstalledFakeWebSocket };
}

describe("platform WebSocket adapter", () => {
  it("maps native open, message, close, send and binaryType without Node helpers", async () => {
    const { instances } = installNativeWebSocket();
    const socket = createPlatformWebSocket("wss://example.test/live");
    const native = instances[0];
    const onOpen = vi.fn();
    const onMessage = vi.fn();
    const onClose = vi.fn();
    socket.on("open", onOpen);
    socket.on("message", onMessage);
    socket.on("close", onClose);

    expect(socket.readyState).toBe(0);
    expect(socket.binaryType).toBe("arraybuffer");
    expect(native.binaryType).toBe("arraybuffer");

    native.open();
    expect(socket.readyState).toBe(1);
    expect(onOpen).toHaveBeenCalledTimes(1);

    const payload = new Uint8Array([1, 2, 3]).buffer;
    native.message(payload);
    expect(onMessage).toHaveBeenCalledWith(payload);

    const blobPayload = new Blob(["hello"]);
    native.message(blobPayload);
    await vi.waitFor(() => expect(onMessage).toHaveBeenCalledTimes(2));
    const delivered = onMessage.mock.calls[1][0] as ArrayBuffer;
    expect(new TextDecoder().decode(delivered)).toBe("hello");

    const bytes = new Uint8Array([4, 5]);
    socket.send(bytes);
    socket.close(1000, "done");
    expect(native.sent).toEqual([bytes]);
    expect(native.closes).toEqual([{ code: 1000, reason: "done" }]);
    expect(onClose).toHaveBeenCalledWith(1000, "done");
  });

  it("removes once listeners after the first matching event", () => {
    const { instances } = installNativeWebSocket();
    const socket = createPlatformWebSocket("wss://example.test/live");
    const once = vi.fn();
    socket.once("open", once);

    instances[0].open();
    instances[0].open();

    expect(once).toHaveBeenCalledTimes(1);
  });
});

describe("platform WebSocket payload helpers", () => {
  it("keeps ArrayBuffer and view payloads byte-accurate", () => {
    expect(Array.from(rawDataToBytes(new Uint8Array([1, 2])))).toEqual([1, 2]);
    expect(Array.from(
      rawDataToBytes(new Uint8Array([0, 1, 2, 3]).subarray(1, 3)),
    )).toEqual([1, 2]);
    expect(rawDataToString(new TextEncoder().encode("ok"))).toBe("ok");
    expect(rawDataToString("plain")).toBe("plain");
  });
});
