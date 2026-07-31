import { describe, expect, it } from "vitest";

class FakeRecorder {
  static supported = true;
  static isTypeSupported(type: string): boolean {
    return FakeRecorder.supported && type === "audio/webm;codecs=opus";
  }

  state: RecordingState = "inactive";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstop: (() => void) | null = null;
  readonly mimeType: string;
  startTimeslice: number | undefined;

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? "";
  }

  start(timeslice?: number): void {
    this.state = "recording";
    this.startTimeslice = timeslice;
  }

  stop(): void {
    this.ondataavailable?.({
      data: new Blob(["webm-audio"], {
        type: "audio/webm;codecs=opus",
      }),
    } as BlobEvent);
    this.state = "inactive";
    this.onstop?.();
  }
}

function fakeVault(existing: string[] = []): {
  adapter: {
    exists: (path: string) => Promise<boolean>;
    mkdir: (path: string) => Promise<void>;
    writeBinary: (path: string, data: ArrayBuffer) => Promise<void>;
  };
  folders: string[];
  writes: Array<{ path: string; bytes: Uint8Array }>;
} {
  const folders: string[] = [];
  const writes: Array<{ path: string; bytes: Uint8Array }> = [];
  return {
    adapter: {
      exists: async (path) => existing.includes(path) || folders.includes(path),
      mkdir: async (path) => {
        folders.push(path);
      },
      writeBinary: async (path, data) => {
        writes.push({ path, bytes: new Uint8Array(data) });
      },
    },
    folders,
    writes,
  };
}

describe("optional live audio recorder", () => {
  it("rejects startup when WebM Opus recording is unavailable", async () => {
    const { assertLiveRecordingSupported } = await import(
      "../src/live-recorder"
    );
    FakeRecorder.supported = false;

    expect(() => assertLiveRecordingSupported(
      FakeRecorder as unknown as typeof MediaRecorder,
    )).toThrow("WebM/Opus");
    FakeRecorder.supported = true;
  });

  it("creates collision-safe paths under the configured folder", async () => {
    const { nextLiveAudioPath } = await import("../src/live-recorder");
    const exists = async (path: string): Promise<boolean> =>
      path === "Crisp ASR/Audio/live-20260729-091011.webm";

    await expect(nextLiveAudioPath(
      "Crisp ASR/Audio",
      new Date(2026, 6, 29, 9, 10, 11),
      exists,
    )).resolves.toBe(
      "Crisp ASR/Audio/live-20260729-091011-2.webm",
    );
  });

  it("records one-second chunks and persists the finalized WebM", async () => {
    const { LiveAudioRecorder } = await import("../src/live-recorder");
    const vault = fakeVault();
    const recorder = new LiveAudioRecorder({
      Recorder: FakeRecorder as unknown as typeof MediaRecorder,
      adapter: vault.adapter,
      folder: "Crisp ASR/Audio",
      now: () => new Date(2026, 6, 29, 9, 10, 11),
    });

    recorder.start({} as MediaStream);
    const path = await recorder.stop();

    expect(path).toBe("Crisp ASR/Audio/live-20260729-091011.webm");
    expect(vault.folders).toEqual(["Crisp ASR", "Crisp ASR/Audio"]);
    expect(vault.writes).toHaveLength(1);
    expect(vault.writes[0].path).toBe(path);
    expect(new TextDecoder().decode(vault.writes[0].bytes)).toBe("webm-audio");
  });

  it("returns the same finalized path when stop is requested twice", async () => {
    const { LiveAudioRecorder } = await import("../src/live-recorder");
    const vault = fakeVault();
    const recorder = new LiveAudioRecorder({
      Recorder: FakeRecorder as unknown as typeof MediaRecorder,
      adapter: vault.adapter,
      folder: "Crisp ASR/Audio",
      now: () => new Date(2026, 6, 29, 9, 10, 11),
    });

    recorder.start({} as MediaStream);
    const first = recorder.stop();
    const second = recorder.stop();

    await expect(first).resolves.toBe(
      "Crisp ASR/Audio/live-20260729-091011.webm",
    );
    await expect(second).resolves.toBe(
      "Crisp ASR/Audio/live-20260729-091011.webm",
    );
    expect(vault.writes).toHaveLength(1);
  });

  it("can discard a startup recording without writing a vault file", async () => {
    const { LiveAudioRecorder } = await import("../src/live-recorder");
    const vault = fakeVault();
    const recorder = new LiveAudioRecorder({
      Recorder: FakeRecorder as unknown as typeof MediaRecorder,
      adapter: vault.adapter,
      folder: "Crisp ASR/Audio",
    });

    recorder.start({} as MediaStream);
    recorder.abort();

    expect(vault.writes).toEqual([]);
  });
});
