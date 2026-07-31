import { describe, expect, it } from "vitest";
import { PendingAudioQueue } from "../src/streaming-client";

describe("PendingAudioQueue", () => {
  it("starts audio at sequence 2 after the full client request consumes sequence 1", () => {
    const queue = new PendingAudioQueue();
    expect(queue.push(new Uint8Array([1]))).toBeNull();
    expect(queue.push(new Uint8Array([2]))).toEqual({
      audio: new Uint8Array([1]),
      sequence: 2,
      final: false,
    });
    expect(queue.finish()).toEqual({
      audio: new Uint8Array([2]),
      sequence: 3,
      final: true,
    });
  });

  it("sends an empty final packet when no microphone packet was captured", () => {
    const queue = new PendingAudioQueue();
    expect(queue.finish()).toEqual({
      audio: new Uint8Array(),
      sequence: 2,
      final: true,
    });
  });
});
