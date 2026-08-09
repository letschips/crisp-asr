import { describe, expect, it, vi } from "vitest";
import {
  DoubaoStreamingClient,
  PendingAudioQueue,
} from "../src/streaming-client";

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

  it("can transfer the unsent tail into a reconnect buffer", () => {
    const queue = new PendingAudioQueue();
    queue.push(new Uint8Array([7, 8]));

    expect(queue.takePending()).toEqual(new Uint8Array([7, 8]));
    expect(queue.takePending()).toBeNull();
  });
});

describe("DoubaoStreamingClient reconnect lifecycle", () => {
  function createClient(): DoubaoStreamingClient {
    return new DoubaoStreamingClient({
      apiKey: "test-key",
      resourceId: "test-resource",
      onPayload: vi.fn(),
      onError: vi.fn(),
    });
  }

  it("keeps every microphone packet captured while reconnecting", () => {
    const client = createClient();
    const internal = client as unknown as {
      reconnecting: boolean;
      reconnectAudio: Uint8Array[];
    };
    internal.reconnecting = true;

    client.sendAudio(new Uint8Array([1]));
    client.sendAudio(new Uint8Array([2]));

    expect(internal.reconnectAudio).toEqual([
      new Uint8Array([1]),
      new Uint8Array([2]),
    ]);
  });

  it("preserves the unsent tail and starts reconnecting after an unexpected close", () => {
    const client = createClient();
    const internal = client as unknown as {
      queue: PendingAudioQueue;
      closedByUser: boolean;
      reconnectAudio: Uint8Array[];
      attemptReconnect: ReturnType<typeof vi.fn>;
      handleUnexpectedClose(): void;
    };
    internal.queue.push(new Uint8Array([9]));
    internal.closedByUser = true;
    internal.attemptReconnect = vi.fn();

    internal.handleUnexpectedClose();

    expect(internal.closedByUser).toBe(false);
    expect(internal.reconnectAudio).toEqual([new Uint8Array([9])]);
    expect(internal.attemptReconnect).toHaveBeenCalledOnce();
  });
});
