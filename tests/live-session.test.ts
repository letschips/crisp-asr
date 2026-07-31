import { describe, expect, it } from "vitest";

function resources(events: string[]): {
  capture: {
    acquire: () => Promise<void>;
    start: () => Promise<MediaStream>;
    stopPcm: () => void;
    stop: () => Promise<void>;
  };
  client: {
    connect: () => Promise<void>;
    finish: () => Promise<void>;
    close: () => void;
  };
  recorder: {
    start: (_stream: MediaStream) => void;
    stop: () => Promise<string>;
  };
} {
  return {
    capture: {
      acquire: async () => {
        events.push("capture:acquire");
      },
      start: async () => {
        events.push("capture:start");
        return {} as MediaStream;
      },
      stopPcm: () => {
        events.push("capture:stop-pcm");
      },
      stop: async () => {
        events.push("capture:stop");
      },
    },
    client: {
      connect: async () => {
        events.push("client:connect");
      },
      finish: async () => {
        events.push("client:finish");
      },
      close: () => {
        events.push("client:close");
      },
    },
    recorder: {
      start: () => {
        events.push("recorder:start");
      },
      stop: async () => {
        events.push("recorder:stop");
        return "Crisp ASR/Audio/live.webm";
      },
    },
  };
}

describe("live session resource ordering", () => {
  it("acquires input before connecting and starts recording last", async () => {
    const { startLiveResources } = await import("../src/live-session");
    const events: string[] = [];
    const session = resources(events);

    await startLiveResources(session);

    expect(events).toEqual([
      "capture:acquire",
      "client:connect",
      "capture:start",
      "recorder:start",
    ]);
  });

  it("releases earlier resources if connection fails", async () => {
    const { startLiveResources } = await import("../src/live-session");
    const events: string[] = [];
    const session = resources(events);
    session.client.connect = async () => {
      events.push("client:connect");
      throw new Error("offline");
    };

    await expect(startLiveResources(session)).rejects.toThrow("offline");

    expect(events).toEqual([
      "capture:acquire",
      "client:connect",
      "client:close",
      "capture:stop",
    ]);
  });

  it("does not continue connecting after startup is cancelled", async () => {
    const { startLiveResources } = await import("../src/live-session");
    const events: string[] = [];
    const session = resources(events);
    const controller = new AbortController();
    session.capture.acquire = async () => {
      events.push("capture:acquire");
      controller.abort();
    };

    await expect(
      startLiveResources(session, controller.signal),
    ).rejects.toThrow("启动已取消");

    expect(events).toEqual([
      "capture:acquire",
      "client:close",
      "capture:stop",
    ]);
  });

  it("finalizes recording before ASR while keeping recording errors non-fatal", async () => {
    const { finishLiveResources } = await import("../src/live-session");
    const events: string[] = [];
    const session = resources(events);
    session.recorder.stop = async () => {
      events.push("recorder:stop");
      throw new Error("disk full");
    };

    const result = await finishLiveResources(session);

    expect(events).toEqual([
      "capture:stop-pcm",
      "recorder:stop",
      "client:finish",
    ]);
    expect(result.audioPath).toBeUndefined();
    expect(result.recordingError?.message).toBe("disk full");
  });

  it("closes the socket before releasing audio inputs", async () => {
    const { closeLiveResources } = await import("../src/live-session");
    const events: string[] = [];
    const session = resources(events);

    await closeLiveResources(session);

    expect(events).toEqual(["client:close", "capture:stop"]);
  });
});
