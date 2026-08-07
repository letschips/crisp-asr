const WEBM_OPUS_MIME = "audio/webm;codecs=opus";
const RECORDING_TIMESLICE_MS = 1_000;

export interface BinaryVaultAdapter {
  exists: (path: string) => Promise<boolean>;
  mkdir: (path: string) => Promise<void>;
  writeBinary: (path: string, data: ArrayBuffer) => Promise<void>;
}

export function assertLiveRecordingSupported(
  Recorder: typeof MediaRecorder,
): void {
  if (!Recorder || !Recorder.isTypeSupported(WEBM_OPUS_MIME)) {
    throw new Error("当前 Obsidian 环境不支持 WebM/Opus 录音");
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
): Promise<string> {
  const stem = `${folder}/${recordingStem(date)}`;
  const preferred = `${stem}.webm`;
  if (!(await exists(preferred))) {
    return preferred;
  }
  for (let index = 2; index < 1_000; index += 1) {
    const candidate = `${stem}-${index}.webm`;
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

  constructor(private readonly options: LiveAudioRecorderOptions) {}

  start(stream: MediaStream): void {
    if (this.recorder) {
      throw new Error("实时录音已经开始");
    }
    assertLiveRecordingSupported(this.options.Recorder);
    const recorder = new this.options.Recorder(stream, {
      mimeType: WEBM_OPUS_MIME,
      audioBitsPerSecond: 96_000,
    });
    this.recorder = recorder;
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
    const blob = new Blob(this.chunks, { type: WEBM_OPUS_MIME });
    if (blob.size === 0) {
      throw new Error("实时录音没有产生音频数据");
    }
    await ensureFolder(this.options.adapter, this.options.folder);
    const path = await nextLiveAudioPath(
      this.options.folder,
      this.options.now?.() ?? new Date(),
      (candidate) => this.options.adapter.exists(candidate),
    );
    await this.options.adapter.writeBinary(path, await blob.arrayBuffer());
    return path;
  }
}
