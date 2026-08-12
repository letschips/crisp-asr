import {
  LivePcmCapture,
  type LivePcmCaptureOptions,
} from "./audio-capture";
import type { MicrophoneInputInfo } from "./audio-input";

interface TestCapture {
  acquire: () => Promise<void>;
  start: () => Promise<MediaStream>;
  stop: () => Promise<void>;
}

interface MicrophoneTestDependencies {
  createCapture?: (
    ownerWindow: Window & typeof globalThis,
    onPacket: (packet: Uint8Array) => void,
    options: LivePcmCaptureOptions,
  ) => TestCapture;
}

export class MicrophoneTestSession {
  private capture: TestCapture | null = null;
  private stopTimer: number | null = null;
  private onStopped: (() => void) | null = null;
  private onLevel: ((level: number) => void) | null = null;

  constructor(
    private readonly ownerWindow: Window & typeof globalThis,
    private readonly dependencies: MicrophoneTestDependencies = {},
  ) {}

  get active(): boolean {
    return this.capture !== null;
  }

  async start(
    deviceId: string,
    onLevel: (level: number) => void,
    onResolved: (input: MicrophoneInputInfo) => void,
    onStopped: () => void = () => undefined,
  ): Promise<void> {
    if (this.capture) {
      throw new Error("麦克风测试已经开始");
    }
    const createCapture = this.dependencies.createCapture
      ?? ((ownerWindow, onPacket, options) =>
        new LivePcmCapture(ownerWindow, onPacket, options));
    const capture = createCapture(this.ownerWindow, () => undefined, {
      microphoneDeviceId: deviceId,
      onLevel,
      onInputEnded: () => {
        void this.stop();
      },
      onInputResolved: onResolved,
    });
    this.capture = capture;
    this.onStopped = onStopped;
    this.onLevel = onLevel;
    try {
      await capture.acquire();
      await capture.start();
      this.stopTimer = this.ownerWindow.setTimeout(() => {
        void this.stop();
      }, 10_000);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.stopTimer !== null) {
      this.ownerWindow.clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    const capture = this.capture;
    const onStopped = this.onStopped;
    const onLevel = this.onLevel;
    this.capture = null;
    this.onStopped = null;
    this.onLevel = null;
    await capture?.stop().catch(() => undefined);
    onLevel?.(0);
    onStopped?.();
  }
}
