import { describe, expect, it } from "vitest";
import { LivePcmCapture } from "../src/audio-capture";

describe("live PCM capture coordinator", () => {
  it("acquires inputs before starting the audio mixer", async () => {
    const events: string[] = [];
    const inputStream = {} as MediaStream;
    const mixedStream = {} as MediaStream;
    const acquired = {
      audioStreams: [inputStream],
      stop: () => {
        events.push("inputs:stop");
      },
    };
    const mixer = {
      start: async (streams: MediaStream[]) => {
        events.push(`mixer:start:${streams.length}`);
        return mixedStream;
      },
      stopPcm: () => {
        events.push("mixer:stop-pcm");
      },
      close: async () => {
        events.push("mixer:close");
      },
    };
    const capture = new LivePcmCapture(
      { navigator: { mediaDevices: {} } } as never,
      () => undefined,
      {
        microphoneDeviceId: "bluetooth",
        onLevel: () => undefined,
        onInputEnded: () => undefined,
        acquireInputs: async (_devices, deviceId) => {
          events.push(`inputs:acquire:${deviceId}`);
          return acquired;
        },
        createMixer: () => mixer,
      },
    );

    await capture.acquire();
    expect(events).toEqual([
      "inputs:acquire:bluetooth",
    ]);
    await expect(capture.start()).resolves.toBe(mixedStream);
    expect(events).toEqual([
      "inputs:acquire:bluetooth",
      "mixer:start:1",
    ]);

    capture.stopPcm();
    await capture.stop();
    expect(events.slice(-3)).toEqual([
      "mixer:stop-pcm",
      "mixer:close",
      "inputs:stop",
    ]);
  });

  it("releases acquired inputs when mixer startup fails", async () => {
    const events: string[] = [];
    const capture = new LivePcmCapture(
      { navigator: { mediaDevices: {} } } as never,
      () => undefined,
      {
        microphoneDeviceId: "default",
        onLevel: () => undefined,
        onInputEnded: () => undefined,
        acquireInputs: async () => ({
          audioStreams: [{} as MediaStream],
          stop: () => {
            events.push("inputs:stop");
          },
        }),
        createMixer: () => ({
          start: async () => {
            throw new Error("graph failed");
          },
          stopPcm: () => undefined,
          close: async () => {
            events.push("mixer:close");
          },
        }),
      },
    );

    await capture.acquire();
    await expect(capture.start()).rejects.toThrow("graph failed");

    expect(events).toEqual(["mixer:close", "inputs:stop"]);
  });
});
