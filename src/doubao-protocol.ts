import { gunzipSync, gzipSync } from "node:zlib";

export type ParsedServerFrame =
  | { type: "result"; sequence: number | null; payload: unknown }
  | { type: "error"; code: number; message: string };

const VERSION_AND_HEADER_SIZE = 0x11;
const SERIALIZATION_JSON_AND_GZIP = 0x11;
const SERIALIZATION_NONE_AND_GZIP = 0x01;

function writeInt32(
  target: Uint8Array,
  offset: number,
  value: number,
  signed = false,
): void {
  const view = new DataView(
    target.buffer,
    target.byteOffset,
    target.byteLength,
  );
  if (signed) {
    view.setInt32(offset, value, false);
  } else {
    view.setUint32(offset, value, false);
  }
}

export function buildFullClientRequest(payload: unknown): Uint8Array {
  const compressed = gzipSync(JSON.stringify(payload));
  const frame = new Uint8Array(8 + compressed.length);
  frame.set([
    VERSION_AND_HEADER_SIZE,
    0x10,
    SERIALIZATION_JSON_AND_GZIP,
    0x00,
  ]);
  writeInt32(frame, 4, compressed.length);
  frame.set(compressed, 8);
  return frame;
}

export function buildAudioRequest(
  audio: Uint8Array,
  sequence: number,
  isFinal: boolean,
): Uint8Array {
  const compressed = gzipSync(audio);
  const frame = new Uint8Array(12 + compressed.length);
  frame.set([
    VERSION_AND_HEADER_SIZE,
    isFinal ? 0x23 : 0x21,
    SERIALIZATION_NONE_AND_GZIP,
    0x00,
  ]);
  writeInt32(frame, 4, isFinal ? -Math.abs(sequence) : Math.abs(sequence), true);
  writeInt32(frame, 8, compressed.length);
  frame.set(compressed, 12);
  return frame;
}

export function parseServerFrame(frame: Uint8Array): ParsedServerFrame {
  if (frame.length < 4) {
    throw new Error("豆包返回了不完整的数据帧");
  }
  const headerBytes = (frame[0] & 0x0f) * 4;
  const messageType = frame[1] >> 4;
  const flags = frame[1] & 0x0f;
  const serialization = frame[2] >> 4;
  const compression = frame[2] & 0x0f;
  const view = new DataView(
    frame.buffer,
    frame.byteOffset,
    frame.byteLength,
  );

  if (messageType === 0x0f) {
    if (frame.length < headerBytes + 8) {
      throw new Error("豆包返回了不完整的错误帧");
    }
    const code = view.getUint32(headerBytes, false);
    const messageLength = view.getUint32(headerBytes + 4, false);
    const messageStart = headerBytes + 8;
    const message = new TextDecoder().decode(
      frame.slice(messageStart, messageStart + messageLength),
    );
    return { type: "error", code, message };
  }

  if (messageType !== 0x09) {
    throw new Error(`豆包返回了未知消息类型：${messageType}`);
  }

  let offset = headerBytes;
  let sequence: number | null = null;
  if ((flags & 0x01) === 0x01) {
    if (frame.length < offset + 4) {
      throw new Error("豆包返回帧缺少序列号");
    }
    sequence = view.getInt32(offset, false);
    offset += 4;
  }
  if (frame.length < offset + 4) {
    throw new Error("豆包返回帧缺少负载长度");
  }
  const payloadLength = view.getUint32(offset, false);
  offset += 4;
  if (frame.length < offset + payloadLength) {
    throw new Error("豆包返回帧负载不完整");
  }
  let payload = frame.slice(offset, offset + payloadLength);
  if (compression === 0x01) {
    payload = gunzipSync(payload);
  }
  if (serialization !== 0x01) {
    throw new Error(`豆包返回了不支持的序列化格式：${serialization}`);
  }
  return {
    type: "result",
    sequence,
    payload: JSON.parse(new TextDecoder().decode(payload)),
  };
}
