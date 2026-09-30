export type ReadAloudState =
  | "loading"
  | "playing"
  | "paused"
  | "stopped"
  | "finished"
  | "failed";

export interface ReadAloudStatus {
  state: ReadAloudState;
  /** 当前段落下标（0 起）。 */
  index: number;
  total: number;
  error?: string;
}

export interface AudioSink {
  /** 播放完成（或被 stop）时 resolve。 */
  play(audio: ArrayBuffer): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
}

export interface ReadAloudOptions {
  synthesize(text: string): Promise<ArrayBuffer>;
  sink: AudioSink;
  onStatus?(status: ReadAloudStatus): void;
  /** 当前段之外最多提前合成几段。 */
  prefetch?: number;
}

const TERMINAL: ReadonlySet<ReadAloudState> = new Set(["stopped", "finished", "failed"]);

/**
 * 按段合成、按段播放。合成比播放快约 2 倍（2026-09-30 冒烟测试），
 * 所以只预取有限段数：既不断音，也不在用户中途停止时浪费太多额度。
 */
export class ReadAloudSession {
  status: ReadAloudStatus;
  private readonly cache = new Map<number, Promise<ArrayBuffer>>();
  private readonly prefetch: number;
  private stopped = false;
  private paused = false;
  private playing = false;
  private wakePaused: (() => void) | null = null;

  constructor(
    private readonly chunks: string[],
    private readonly options: ReadAloudOptions,
  ) {
    this.prefetch = Math.max(0, options.prefetch ?? 1);
    this.status = { state: "loading", index: 0, total: chunks.length };
  }

  get isActive(): boolean {
    return !TERMINAL.has(this.status.state);
  }

  async run(): Promise<void> {
    const total = this.chunks.length;
    for (let i = 0; i < total; i++) {
      if (this.stopped) return;
      for (let j = i; j <= Math.min(total - 1, i + this.prefetch); j++) {
        this.request(j);
      }
      this.update(this.paused ? "paused" : "loading", i);
      let audio: ArrayBuffer;
      try {
        audio = await this.cache.get(i)!;
      } catch (error) {
        if (!this.stopped) this.fail(i, error);
        return;
      }
      this.cache.delete(i);
      await this.waitWhilePaused();
      if (this.stopped) return;
      this.update("playing", i);
      this.playing = true;
      try {
        await this.options.sink.play(audio);
      } catch (error) {
        if (!this.stopped) this.fail(i, error);
        return;
      } finally {
        this.playing = false;
      }
    }
    if (!this.stopped) this.update("finished", Math.max(0, total - 1));
  }

  pause(): void {
    if (!this.isActive || this.paused) return;
    this.paused = true;
    if (this.playing) this.options.sink.pause();
    this.update("paused", this.status.index);
  }

  resume(): void {
    if (!this.isActive || !this.paused) return;
    this.paused = false;
    if (this.playing) this.options.sink.resume();
    this.update(this.playing ? "playing" : "loading", this.status.index);
    this.wakePaused?.();
  }

  stop(): void {
    if (!this.isActive) return;
    this.stopped = true;
    this.paused = false;
    this.options.sink.stop();
    this.update("stopped", this.status.index);
    this.wakePaused?.();
  }

  private request(index: number): void {
    if (this.cache.has(index)) return;
    const pending = this.options.synthesize(this.chunks[index]);
    // 预取的段可能在被 await 之前就失败；错误在轮到它时再上报。
    pending.catch(() => undefined);
    this.cache.set(index, pending);
  }

  private waitWhilePaused(): Promise<void> {
    if (!this.paused || this.stopped) return Promise.resolve();
    return new Promise((resolve) => {
      this.wakePaused = () => {
        this.wakePaused = null;
        resolve();
      };
    });
  }

  private fail(index: number, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.update("failed", index, message);
  }

  private update(state: ReadAloudState, index: number, error?: string): void {
    this.status = { state, index, total: this.chunks.length, ...(error ? { error } : {}) };
    this.options.onStatus?.(this.status);
  }
}

/** 用 HTMLAudioElement 播放 WAV，桌面端和移动端通用。 */
export class HtmlAudioSink implements AudioSink {
  private element: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private settle: (() => void) | null = null;

  constructor(private readonly mimeType = "audio/wav") {}

  play(audio: ArrayBuffer): Promise<void> {
    this.release();
    const url = URL.createObjectURL(new Blob([audio], { type: this.mimeType }));
    const element = new Audio(url);
    this.objectUrl = url;
    this.element = element;
    return new Promise<void>((resolve, reject) => {
      const finish = (error?: unknown) => {
        if (this.element !== element) return;
        this.release();
        if (error) reject(error);
        else resolve();
      };
      this.settle = () => finish();
      element.onended = () => finish();
      element.onerror = () => finish(new Error("音频播放失败"));
      element.play().catch((error) => finish(error));
    });
  }

  pause(): void {
    this.element?.pause();
  }

  resume(): void {
    void this.element?.play().catch(() => undefined);
  }

  stop(): void {
    this.settle?.();
  }

  private release(): void {
    const element = this.element;
    this.element = null;
    this.settle = null;
    if (element) {
      element.onended = null;
      element.onerror = null;
      element.pause();
      element.removeAttribute("src");
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}
