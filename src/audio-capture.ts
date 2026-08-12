import {
  acquireAudioInputs,
  type AcquiredAudioInputs,
  type AudioMediaDevices,
} from "./audio-input";
import {
  LiveAudioMixer,
  type LiveAudioMixerOptions,
} from "./audio-mixer";

interface AudioMixer {
  start: (streams: MediaStream[]) => Promise<MediaStream>;
  stopPcm: () => void;
  close: () => Promise<void>;
}

export interface LivePcmCaptureOptions {
  microphoneDeviceId: string;
  onLevel: (level: number) => void;
  onInputEnded: () => void;
  onInputResolved?: (input: AcquiredAudioInputs["microphone"]) => void;
  onSilence?: () => void;
  silenceDurationMs?: number;
  acquireInputs?: typeof acquireAudioInputs;
  createMixer?: (
    ownerWindow: Window & typeof globalThis,
    options: LiveAudioMixerOptions,
  ) => AudioMixer;
}

export class LivePcmCapture {
  private acquired: AcquiredAudioInputs | null = null;
  private mixer: AudioMixer | null = null;

  constructor(
    private readonly ownerWindow: Window & typeof globalThis,
    private readonly onPacket: (packet: Uint8Array) => void,
    private readonly options: LivePcmCaptureOptions = {
      microphoneDeviceId: "default",
      onLevel: () => undefined,
      onInputEnded: () => undefined,
    },
  ) {}

  async acquire(): Promise<void> {
    if (this.acquired) {
      throw new Error("实时音频输入已经获取");
    }
    const mediaDevices = this.ownerWindow.navigator.mediaDevices;
    if (!mediaDevices) {
      throw new Error("当前环境无法访问音频输入");
    }
    const acquire = this.options.acquireInputs ?? acquireAudioInputs;
    this.acquired = await acquire(
      mediaDevices as unknown as AudioMediaDevices,
      this.options.microphoneDeviceId,
      this.options.onInputEnded,
    );
    this.options.onInputResolved?.(this.acquired.microphone);
  }

  async start(): Promise<MediaStream> {
    const acquired = this.acquired;
    if (!acquired) {
      throw new Error("请先获取实时音频输入");
    }
    if (this.mixer) {
      throw new Error("实时音频混音已经开始");
    }
    const createMixer = this.options.createMixer
      ?? ((ownerWindow, options) => new LiveAudioMixer(ownerWindow, options));
    const mixer = createMixer(this.ownerWindow, {
      onPacket: this.onPacket,
      onLevel: this.options.onLevel,
      onSilence: this.options.onSilence,
      silenceDurationMs: this.options.silenceDurationMs,
    });
    this.mixer = mixer;
    try {
      return await mixer.start(acquired.audioStreams);
    } catch (error) {
      await mixer.close().catch(() => undefined);
      this.mixer = null;
      acquired.stop();
      this.acquired = null;
      throw error;
    }
  }

  stopPcm(): void {
    this.mixer?.stopPcm();
  }

  async stop(): Promise<void> {
    const mixer = this.mixer;
    const acquired = this.acquired;
    this.mixer = null;
    this.acquired = null;
    await mixer?.close().catch(() => undefined);
    acquired?.stop();
    this.options.onLevel(0);
  }
}
