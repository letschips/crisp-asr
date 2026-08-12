import { describe, expect, it, vi } from "vitest";
import { MicrophoneTestSession } from "../src/microphone-test";

describe("microphone test session", () => {
  it("uses the selected input, emits levels and stops without uploading", async () => {
    const events: string[] = [];
    let level: ((value: number) => void) | undefined;
    let resolved: ((value: { deviceId: string; label: string; usedDefaultFallback: boolean }) => void) | undefined;
    const session = new MicrophoneTestSession(window, {
      createCapture: (_ownerWindow, onPacket, options) => {
        onPacket(new Uint8Array([1]));
        level = options.onLevel;
        resolved = options.onInputResolved;
        expect(options.microphoneDeviceId).toBe("wireless-rx");
        return {
          acquire: async () => {
            events.push("acquire");
          },
          start: async () => {
            events.push("start");
            return {} as MediaStream;
          },
          stop: async () => {
            events.push("stop");
          },
        };
      },
    });
    const levels: number[] = [];
    const labels: string[] = [];

    await session.start(
      "wireless-rx",
      (value) => levels.push(value),
      (input) => labels.push(input.label),
    );
    level?.(0.72);
    resolved?.({
      deviceId: "wireless-rx",
      label: "Wireless Mic Rx",
      usedDefaultFallback: false,
    });
    await session.stop();

    expect(events).toEqual(["acquire", "start", "stop"]);
    expect(levels).toEqual([0.72, 0]);
    expect(labels).toEqual(["Wireless Mic Rx"]);
  });

  it("automatically stops after ten seconds", async () => {
    vi.useFakeTimers();
    let stops = 0;
    const session = new MicrophoneTestSession(window, {
      createCapture: () => ({
        acquire: async () => undefined,
        start: async () => ({} as MediaStream),
        stop: async () => {
          stops += 1;
        },
      }),
    });

    await session.start("default", () => undefined, () => undefined);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(stops).toBe(1);
    expect(session.active).toBe(false);
    vi.useRealTimers();
  });
});
// @vitest-environment jsdom
