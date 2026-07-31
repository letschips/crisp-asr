import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  buildAudioRequest,
  buildFullClientRequest,
  parseServerFrame,
} from "../src/doubao-protocol";

function readInt32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .getInt32(offset, false);
}

describe("Doubao streaming protocol", () => {
  it("builds the initial gzip-compressed JSON request", () => {
    const frame = buildFullClientRequest({ user: { uid: "crisp-asr" } });
    expect([...frame.slice(0, 4)]).toEqual([0x11, 0x10, 0x11, 0x00]);
    const payloadLength = readInt32(frame, 4);
    expect(payloadLength).toBe(frame.length - 8);
    expect(
      JSON.parse(gunzipSync(frame.slice(8)).toString("utf8")),
    ).toEqual({ user: { uid: "crisp-asr" } });
  });

  it("marks intermediate and final audio packets with signed sequences", () => {
    const intermediate = buildAudioRequest(new Uint8Array([1, 2]), 7, false);
    expect([...intermediate.slice(0, 4)]).toEqual([0x11, 0x21, 0x01, 0x00]);
    expect(readInt32(intermediate, 4)).toBe(7);
    expect([...gunzipSync(intermediate.slice(12))]).toEqual([1, 2]);

    const final = buildAudioRequest(new Uint8Array([3]), 8, true);
    expect([...final.slice(0, 4)]).toEqual([0x11, 0x23, 0x01, 0x00]);
    expect(readInt32(final, 4)).toBe(-8);
    expect([...gunzipSync(final.slice(12))]).toEqual([3]);
  });

  it("parses gzip-compressed server results", () => {
    const payload = gzipSync(JSON.stringify({
      result: {
        text: "你好。",
        utterances: [
          { text: "你好。", start_time: 0, end_time: 800, definite: true },
        ],
      },
    }));
    const frame = new Uint8Array(12 + payload.length);
    frame.set([0x11, 0x91, 0x11, 0x00], 0);
    const view = new DataView(frame.buffer);
    view.setInt32(4, 2, false);
    view.setUint32(8, payload.length, false);
    frame.set(payload, 12);

    expect(parseServerFrame(frame)).toEqual({
      type: "result",
      sequence: 2,
      payload: {
        result: {
          text: "你好。",
          utterances: [
            { text: "你好。", start_time: 0, end_time: 800, definite: true },
          ],
        },
      },
    });
  });

  it("parses server errors without treating them as transcripts", () => {
    const message = new TextEncoder().encode("bad audio");
    const frame = new Uint8Array(12 + message.length);
    frame.set([0x11, 0xf0, 0x10, 0x00], 0);
    const view = new DataView(frame.buffer);
    view.setUint32(4, 45_000_151, false);
    view.setUint32(8, message.length, false);
    frame.set(message, 12);
    expect(parseServerFrame(frame)).toEqual({
      type: "error",
      code: 45_000_151,
      message: "bad audio",
    });
  });
});
