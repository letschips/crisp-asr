export const WS_CONNECTING = 0;
export const WS_OPEN = 1;
export const WS_CLOSING = 2;
export const WS_CLOSED = 3;

export interface IWebSocket {
  readyState: number;
  binaryType?: string;
  send(data: string | ArrayBuffer | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  on(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
  off(event: string, listener: (...args: any[]) => void): this;
  emit(event: string, ...args: any[]): void;
}

export function rawDataToBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array();
}

export function rawDataToString(data: unknown): string {
  if (typeof data === "string") return data;
  if (typeof Buffer !== "undefined") {
    if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
    if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
    if (ArrayBuffer.isView(data)) {
      return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
    }
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }
  return String(data ?? "");
}

function getDesktopWsClass(): any {
  if (typeof process !== "undefined" && Boolean(process?.versions?.node)) {
    try {
      // Lazy load ws only on Desktop / Node environments to avoid breaking iOS mobile loader
      return require("ws");
    } catch {
      return null;
    }
  }
  return null;
}

export function createPlatformWebSocket(
  url: string,
  options?: { headers?: Record<string, string> }
): IWebSocket {
  const isNode = typeof process !== "undefined" && Boolean(process?.versions?.node);

  // In Node / Desktop environments where headers are requested (e.g. Doubao streaming), use Node 'ws'
  if (isNode && options?.headers) {
    const NodeWs = getDesktopWsClass();
    if (NodeWs) {
      return new NodeWs(url, options) as unknown as IWebSocket;
    }
  }

  // In Browser (Electron Chromium, iOS Safari WKWebView, Android) or Node without custom headers
  const NativeWS =
    (typeof window !== "undefined" ? window.WebSocket : null) ||
    (typeof globalThis !== "undefined" ? globalThis.WebSocket : null);

  if (!NativeWS) {
    // If native WebSocket is not available (e.g. older Node in CLI tests), try Node ws
    const NodeWs = getDesktopWsClass();
    if (NodeWs) {
      return new NodeWs(url, options) as unknown as IWebSocket;
    }
    throw new Error("当前环境不支持 WebSocket");
  }

  const ws = new NativeWS(url);
  const listeners = new Map<string, Function[]>();
  let binaryTypeVal = "arraybuffer";

  try {
    ws.binaryType = "arraybuffer";
  } catch {}

  const wrapper: IWebSocket = {
    get readyState() {
      return ws.readyState;
    },
    get binaryType() {
      return binaryTypeVal;
    },
    set binaryType(val: string) {
      binaryTypeVal = val;
      try {
        ws.binaryType = val as BinaryType;
      } catch {}
    },
    send(data: any) {
      ws.send(data);
    },
    close(code?: number, reason?: string) {
      ws.close(code, reason);
    },
    on(event: string, fn: Function) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(fn);
      return wrapper;
    },
    once(event: string, fn: Function) {
      const onceFn = (...args: any[]) => {
        wrapper.off(event, onceFn);
        fn(...args);
      };
      return wrapper.on(event, onceFn);
    },
    off(event: string, fn: Function) {
      const list = listeners.get(event);
      if (list) {
        const idx = list.indexOf(fn);
        if (idx >= 0) list.splice(idx, 1);
      }
      return wrapper;
    },
    emit(event: string, ...args: any[]) {
      listeners.get(event)?.slice().forEach((fn) => fn(...args));
    },
  };

  ws.onopen = () => wrapper.emit("open");
  ws.onclose = (ev: CloseEvent) => wrapper.emit("close", ev.code, ev.reason);
  ws.onerror = () => wrapper.emit("error", new Error("WebSocket 连接异常"));
  ws.onmessage = async (ev: MessageEvent) => {
    let data = ev.data;
    if (typeof Blob !== "undefined" && data instanceof Blob) {
      data = await data.arrayBuffer();
    }
    wrapper.emit("message", data);
  };

  return wrapper;
}
