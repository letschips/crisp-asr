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

class Mp4CodecRecorder {
  static isTypeSupported(type: string): boolean {
    return type === "audio/mp4;codecs=mp4a.40.2";
  }

  state: RecordingState = "inactive";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstop: (() => void) | null = null;
  readonly mimeType = "audio/mp4";

  constructor(_stream: MediaStream, _options?: MediaRecorderOptions) {}

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    this.ondataavailable?.({
      data: new Blob(["mp4-audio"], { type: "audio/mp4" }),
    } as BlobEvent);
    this.state = "inactive";
    this.onstop?.();
  }
}

class ProbeLessRecorder {
  state: RecordingState = "inactive";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstop: (() => void) | null = null;
  readonly mimeType = "audio/mp4";

  constructor(_stream: MediaStream, _options?: MediaRecorderOptions) {}

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    this.ondataavailable?.({
      data: new Blob(["probe-less-audio"], { type: "audio/mp4" }),
    } as BlobEvent);
    this.state = "inactive";
    this.onstop?.();
  }
}

class RejectingMimeRecorder {
  static isTypeSupported(type: string): boolean {
    return type === "audio/mp4";
  }

  state: RecordingState = "inactive";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstop: (() => void) | null = null;
  readonly mimeType = "audio/mp4";

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    if (options?.mimeType) {
      throw new Error("NotSupportedError");
    }
  }

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    this.ondataavailable?.({
      data: new Blob(["default-mime-audio"], { type: "audio/mp4" }),
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

  it("lets MediaRecorder choose a default format when isTypeSupported is missing", async () => {
    const {
      LiveAudioRecorder,
      assertLiveRecordingSupported,
      resolveSupportedRecordingMime,
    } = await import("../src/live-recorder");
    const probeLess = ProbeLessRecorder as unknown as typeof MediaRecorder;

    expect(resolveSupportedRecordingMime(probeLess)).toEqual({
      mimeType: "",
      extension: "webm",
    });
    expect(() => assertLiveRecordingSupported(probeLess)).not.toThrow();

    const vault = fakeVault();
    const recorder = new LiveAudioRecorder({
      Recorder: probeLess,
      adapter: vault.adapter,
      folder: "Crisp ASR/Audio",
      now: () => new Date(2026, 6, 29, 9, 10, 11),
    });
    recorder.start({} as MediaStream);

    await expect(recorder.stop()).resolves.toBe(
      "Crisp ASR/Audio/live-20260729-091011.mp4",
    );
    expect(vault.writes[0].path.endsWith(".mp4")).toBe(true);
    expect(new TextDecoder().decode(vault.writes[0].bytes)).toBe(
      "probe-less-audio",
    );
  });

  it("maps iOS MP4 codec-only support to an mp4 recording", async () => {
    const { resolveSupportedRecordingMime } = await import(
      "../src/live-recorder"
    );
    expect(resolveSupportedRecordingMime(
      Mp4CodecRecorder as unknown as typeof MediaRecorder,
    )).toEqual({ mimeType: "audio/mp4;codecs=mp4a.40.2", extension: "mp4" });
  });

  it("retries with the recorder default when an advertised MIME type is refused", async () => {
    const { LiveAudioRecorder } = await import("../src/live-recorder");
    const vault = fakeVault();
    const recorder = new LiveAudioRecorder({
      Recorder: RejectingMimeRecorder as unknown as typeof MediaRecorder,
      adapter: vault.adapter,
      folder: "Crisp ASR/Audio",
      now: () => new Date(2026, 6, 29, 9, 10, 11),
    });

    expect(() => recorder.start({} as MediaStream)).not.toThrow();
    await expect(recorder.stop()).resolves.toBe(
      "Crisp ASR/Audio/live-20260729-091011.mp4",
    );
    expect(new TextDecoder().decode(vault.writes[0].bytes)).toBe(
      "default-mime-audio",
    );
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
