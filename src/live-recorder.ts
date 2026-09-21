export const WEBM_OPUS_MIME = "audio/webm;codecs=opus";
const RECORDING_TIMESLICE_MS = 1_000;

export interface BinaryVaultAdapter {
  exists: (path: string) => Promise<boolean>;
  mkdir: (path: string) => Promise<void>;
  writeBinary: (path: string, data: ArrayBuffer) => Promise<void>;
}

export interface RecordingMimeConfig {
  mimeType: string;
  extension: string;
}

const RECORDING_MIME_CANDIDATES = [
  WEBM_OPUS_MIME,
  "audio/webm",
  "audio/mp4",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4;codecs=mp4a.40.5",
  "audio/aac",
];

export function recordingExtensionForMime(mimeType: string): string {
  const normalized = (mimeType || "").toLowerCase();
  if (
    normalized.includes("mp4")
    || normalized.includes("m4a")
  ) {
    return "mp4";
  }
  if (normalized.includes("aac")) {
    return "aac";
  }
  if (normalized.includes("ogg")) {
    return "ogg";
  }
  return "webm";
}

// Returns the first supported MIME type, null when the probe ran and no
// candidate was supported, or undefined when the probe itself is unavailable.
function probeSupportedRecordingMime(
  Recorder: typeof MediaRecorder,
): string | null | undefined {
  if (!Recorder || typeof Recorder.isTypeSupported !== "function") {
    return undefined;
  }
  let probed = false;
  for (const candidate of RECORDING_MIME_CANDIDATES) {
    let supported = false;
    try {
      supported = Recorder.isTypeSupported(candidate);
      probed = true;
    } catch {
      continue;
    }
    if (supported) {
      return candidate;
    }
  }
  return probed ? null : undefined;
}

export function resolveSupportedRecordingMime(
  Recorder: typeof MediaRecorder,
): RecordingMimeConfig {
  const probed = probeSupportedRecordingMime(Recorder);
  if (typeof probed === "string") {
    return {
      mimeType: probed,
      extension: recordingExtensionForMime(probed),
    };
  }
  // Let the recorder choose its default. Safari can support audio/mp4 while
  // exposing no reliable isTypeSupported probe, and forcing WebM breaks it.
  return { mimeType: "", extension: "webm" };
}

export function assertLiveRecordingSupported(
  Recorder: typeof MediaRecorder,
): void {
  if (!Recorder) {
    throw new Error("当前环境不支持实时录音");
  }
  if (probeSupportedRecordingMime(Recorder) === null) {
    throw new Error("当前 Obsidian 环境不支持 WebM/Opus 或 MP4 录音");
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function recordingStem(date: Date): string {
  return `live-${date.getFullYear()}${pad(date.getMonth() + 1)}${
    pad(date.getDate())
  }-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export async function nextLiveAudioPath(
  folder: string,
  date: Date,
  exists: (path: string) => Promise<boolean>,
  extension = "webm",
): Promise<string> {
  const stem = `${folder}/${recordingStem(date)}`;
  const preferred = `${stem}.${extension}`;
  if (!(await exists(preferred))) {
    return preferred;
  }
  for (let index = 2; index < 1_000; index += 1) {
    const candidate = `${stem}-${index}.${extension}`;
    if (!(await exists(candidate))) {
      return candidate;
    }
  }
  throw new Error("无法为实时录音分配唯一文件名");
}

async function ensureFolder(
  adapter: BinaryVaultAdapter,
  folder: string,
): Promise<void> {
  const parts = folder.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!(await adapter.exists(current))) {
      await adapter.mkdir(current);
    }
  }
}

export interface LiveAudioRecorderOptions {
  Recorder: typeof MediaRecorder;
  adapter: BinaryVaultAdapter;
  folder: string;
  now?: () => Date;
}

export class LiveAudioRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stopPromise: Promise<string> | null = null;
  private recorderError: Error | null = null;
  private mimeConfig: RecordingMimeConfig = {
    mimeType: WEBM_OPUS_MIME,
    extension: "webm",
  };

  constructor(private readonly options: LiveAudioRecorderOptions) {}

  start(stream: MediaStream): void {
    if (this.recorder) {
      throw new Error("实时录音已经开始");
    }
    assertLiveRecordingSupported(this.options.Recorder);
    this.mimeConfig = resolveSupportedRecordingMime(this.options.Recorder);
    let recorder: MediaRecorder;
    if (this.mimeConfig.mimeType) {
      try {
        recorder = new this.options.Recorder(stream, {
          mimeType: this.mimeConfig.mimeType,
          audioBitsPerSecond: 96_000,
        });
      } catch {
        // Some WebKit builds advertise a MIME type they refuse to construct
        // with. Retry with the recorder default before failing the session.
        this.mimeConfig = { mimeType: "", extension: "webm" };
        recorder = new this.options.Recorder(stream, {
          audioBitsPerSecond: 96_000,
        });
      }
    } else {
      recorder = new this.options.Recorder(stream, {
        audioBitsPerSecond: 96_000,
      });
    }
    this.recorder = recorder;
    if (!this.mimeConfig.mimeType) {
      const actualType = typeof recorder.mimeType === "string"
        ? recorder.mimeType
        : "";
      this.mimeConfig = {
        mimeType: actualType,
        extension: recordingExtensionForMime(actualType),
      };
    }
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };
    recorder.onerror = (event) => {
      const cause = (event as Event & { error?: Error }).error;
      this.recorderError = cause ?? new Error("浏览器录音失败");
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
    };
    recorder.start(RECORDING_TIMESLICE_MS);
  }

  stop(): Promise<string> {
    if (this.stopPromise) {
      return this.stopPromise;
    }
    const recorder = this.recorder;
    if (!recorder) {
      return Promise.reject(new Error("实时录音尚未开始"));
    }
    this.stopPromise = new Promise<string>((resolve, reject) => {
      recorder.onstop = () => {
        void this.persist().then(resolve, reject);
      };
      try {
        if (recorder.state === "inactive") {
          void this.persist().then(resolve, reject);
        } else {
          recorder.stop();
        }
      } catch (error) {
        reject(error);
      }
    });
    return this.stopPromise;
  }

  abort(): void {
    const recorder = this.recorder;
    if (!recorder || this.stopPromise) {
      return;
    }
    recorder.ondataavailable = null;
    recorder.onerror = null;
    recorder.onstop = null;
    this.chunks = [];
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
    this.recorder = null;
  }

  private async persist(): Promise<string> {
    if (this.recorderError) {
      throw this.recorderError;
    }
    const blobType = this.mimeConfig.mimeType
      || this.recorder?.mimeType
      || WEBM_OPUS_MIME;
    const blob = new Blob(this.chunks, {
      type: blobType,
    });
    if (blob.size === 0) {
      throw new Error("实时录音没有产生音频数据");
    }
    await ensureFolder(this.options.adapter, this.options.folder);
    const path = await nextLiveAudioPath(
      this.options.folder,
      this.options.now?.() ?? new Date(),
      (candidate) => this.options.adapter.exists(candidate),
      this.mimeConfig.extension,
    );
    await this.options.adapter.writeBinary(path, await blob.arrayBuffer());
    return path;
  }
}
