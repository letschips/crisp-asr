import { describe, expect, it } from "vitest";

class FakeTrack {
  stopped = false;
  private readonly listeners = new Set<() => void>();

  addEventListener(type: string, listener: () => void): void {
    if (type === "ended") {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === "ended") {
      this.listeners.delete(listener);
    }
  }

  stop(): void {
    this.stopped = true;
  }

  end(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function fakeStream(audio: FakeTrack[], video: FakeTrack[] = []): MediaStream {
  return {
    getAudioTracks: () => audio,
    getVideoTracks: () => video,
    getTracks: () => [...audio, ...video],
  } as unknown as MediaStream;
}

describe("audio input acquisition", () => {
  it("refreshes the microphone list when an external input is attached", async () => {
    const { subscribeToMicrophoneChanges } = await import(
      "../src/audio-input"
    );
    const listeners = new Set<() => void>();
    const mediaDevices = {
      addEventListener: (type: string, listener: () => void) => {
        if (type === "devicechange") {
          listeners.add(listener);
        }
      },
      removeEventListener: (type: string, listener: () => void) => {
        if (type === "devicechange") {
          listeners.delete(listener);
        }
      },
    };
    let refreshes = 0;
    const unsubscribe = subscribeToMicrophoneChanges(
      mediaDevices,
      () => {
        refreshes += 1;
      },
    );

    for (const listener of listeners) {
      listener();
    }
    expect(refreshes).toBe(1);

    unsubscribe();
    for (const listener of listeners) {
      listener();
    }
    expect(refreshes).toBe(1);
  });

  it("lists a stable default before physical microphones", async () => {
    const { listMicrophoneDevices } = await import("../src/audio-input");
    const devices = {
      enumerateDevices: async () => [
        { kind: "audiooutput", deviceId: "speaker", label: "Speaker" },
        { kind: "audioinput", deviceId: "default", label: "Default" },
        { kind: "audioinput", deviceId: "mic-1", label: "MacBook 麦克风" },
        { kind: "audioinput", deviceId: "mic-2", label: "" },
      ],
    };

    await expect(listMicrophoneDevices(devices)).resolves.toEqual([
      { deviceId: "default", label: "系统默认" },
      { deviceId: "mic-1", label: "MacBook 麦克风" },
      { deviceId: "mic-2", label: "麦克风 2" },
    ]);
  });

  it("falls back to default when the saved microphone disappears", async () => {
    const { resolveMicrophoneDeviceId } = await import("../src/audio-input");

    expect(resolveMicrophoneDeviceId("missing", [
      { deviceId: "default", label: "系统默认" },
      { deviceId: "mic-1", label: "USB Mic" },
    ])).toBe("default");
    expect(resolveMicrophoneDeviceId("mic-1", [
      { deviceId: "default", label: "系统默认" },
      { deviceId: "mic-1", label: "USB Mic" },
    ])).toBe("mic-1");
  });

  it("keeps an authorized preferred device visible before labels are available", async () => {
    const { preservePreferredMicrophone } = await import(
      "../src/audio-input"
    );

    expect(preservePreferredMicrophone([
      { deviceId: "default", label: "系统默认" },
    ], "bluetooth")).toEqual([
      { deviceId: "default", label: "系统默认" },
      { deviceId: "bluetooth", label: "已选麦克风（刷新后显示名称）" },
    ]);
  });

  it("acquires only the selected microphone in microphone mode", async () => {
    const { acquireAudioInputs } = await import("../src/audio-input");
    const microphoneTrack = new FakeTrack();
    const microphoneStream = fakeStream([microphoneTrack]);
    let userConstraints: MediaStreamConstraints | undefined;
    let displayCalls = 0;
    const devices = {
      getUserMedia: async (constraints: MediaStreamConstraints) => {
        userConstraints = constraints;
        return microphoneStream;
      },
      getDisplayMedia: async () => {
        displayCalls += 1;
        return fakeStream([]);
      },
    };

    const acquired = await acquireAudioInputs(
      devices,
      "microphone",
      "mic-1",
      () => undefined,
    );

    expect(acquired.audioStreams).toEqual([microphoneStream]);
    expect(displayCalls).toBe(0);
    expect(userConstraints?.audio).toMatchObject({
      deviceId: { exact: "mic-1" },
      channelCount: 1,
      echoCancellation: true,
    });
    acquired.stop();
    expect(microphoneTrack.stopped).toBe(true);
  });

  it("uses the system picker and microphone in combined mode", async () => {
    const { acquireAudioInputs } = await import("../src/audio-input");
    const microphoneStream = fakeStream([new FakeTrack()]);
    const systemAudio = new FakeTrack();
    const systemVideo = new FakeTrack();
    const displayStream = fakeStream([systemAudio], [systemVideo]);
    const devices = {
      getUserMedia: async () => microphoneStream,
      getDisplayMedia: async (constraints?: DisplayMediaStreamOptions) => {
        expect(constraints).toEqual({
          video: true,
          audio: true,
          systemAudio: "include",
        });
        return displayStream;
      },
    };

    const acquired = await acquireAudioInputs(
      devices,
      "computer-and-microphone",
      "default",
      () => undefined,
    );

    expect(acquired.audioStreams).toEqual([displayStream, microphoneStream]);
    acquired.stop();
    expect(systemAudio.stopped).toBe(true);
    expect(systemVideo.stopped).toBe(true);
  });

  it("retries the system default when a saved microphone is gone", async () => {
    const { acquireAudioInputs } = await import("../src/audio-input");
    const constraints: MediaStreamConstraints[] = [];
    const defaultStream = fakeStream([new FakeTrack()]);
    const devices = {
      getUserMedia: async (next: MediaStreamConstraints) => {
        constraints.push(next);
        if (constraints.length === 1) {
          throw new DOMException("missing", "OverconstrainedError");
        }
        return defaultStream;
      },
      getDisplayMedia: async () => fakeStream([]),
    };

    const acquired = await acquireAudioInputs(
      devices,
      "microphone",
      "missing-device",
      () => undefined,
    );

    expect(constraints[0].audio).toMatchObject({
      deviceId: { exact: "missing-device" },
    });
    expect(constraints[1].audio).not.toHaveProperty("deviceId");
    acquired.stop();
  });

  it("rejects a shared source without audio and releases its video track", async () => {
    const { acquireAudioInputs } = await import("../src/audio-input");
    const videoTrack = new FakeTrack();
    const devices = {
      getUserMedia: async () => fakeStream([new FakeTrack()]),
      getDisplayMedia: async () => fakeStream([], [videoTrack]),
    };

    await expect(acquireAudioInputs(
      devices,
      "computer",
      "default",
      () => undefined,
    )).rejects.toThrow("没有共享电脑声音");
    expect(videoTrack.stopped).toBe(true);
  });

  it("reports an ended input once and cleanup does not report it", async () => {
    const { acquireAudioInputs } = await import("../src/audio-input");
    const track = new FakeTrack();
    let ended = 0;
    const devices = {
      getUserMedia: async () => fakeStream([track]),
      getDisplayMedia: async () => fakeStream([]),
    };
    const acquired = await acquireAudioInputs(
      devices,
      "microphone",
      "default",
      () => {
        ended += 1;
      },
    );

    track.end();
    track.end();
    expect(ended).toBe(1);
    acquired.stop();
    track.end();
    expect(ended).toBe(1);
  });
});
