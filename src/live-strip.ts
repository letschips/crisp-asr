export type LiveStripMode =
  | "idle"
  | "connecting"
  | "listening"
  | "finishing"
  | "error";

export interface LiveStripState {
  mode: LiveStripMode;
  elapsed: string;
  preview: string;
}

export interface LiveStripActions {
  onOpen: () => void;
  onStop: () => void;
}

export class CrispAsrLiveStrip {
  private root: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private timer: HTMLElement | null = null;
  private preview: HTMLElement | null = null;
  private stopButton: HTMLButtonElement | null = null;

  constructor(
    private readonly document: Document,
    private readonly actions: LiveStripActions,
  ) {}

  update(state: LiveStripState): void {
    if (
      state.mode !== "connecting"
      && state.mode !== "listening"
      && state.mode !== "finishing"
    ) {
      this.destroy();
      return;
    }
    this.ensureCreated();
    if (!this.root || !this.status || !this.timer || !this.preview) {
      return;
    }
    this.root.className = `crisp-asr-live-strip is-${state.mode}`;
    this.status.textContent = state.mode === "connecting"
      ? "正在连接"
      : state.mode === "finishing"
        ? "正在收尾"
        : "实时听写中";
    this.timer.textContent = state.elapsed;
    this.preview.textContent = state.preview || "声音会继续写入当前目标笔记";
    if (this.stopButton) {
      this.stopButton.disabled = state.mode !== "listening";
    }
  }

  destroy(): void {
    this.root?.remove();
    this.root = null;
    this.status = null;
    this.timer = null;
    this.preview = null;
    this.stopButton = null;
  }

  private ensureCreated(): void {
    if (this.root?.isConnected) {
      return;
    }
    const root = this.document.createElement("aside");
    root.className = "crisp-asr-live-strip";
    root.setAttribute("aria-live", "polite");

    const main = this.document.createElement("button");
    main.type = "button";
    main.className = "crisp-asr-live-strip__main";
    main.setAttribute("aria-label", "打开 Crisp ASR 转写面板");
    main.addEventListener("click", this.actions.onOpen);

    const pulse = this.document.createElement("span");
    pulse.className = "crisp-asr-live-strip__pulse";
    const status = this.document.createElement("span");
    status.className = "crisp-asr-live-strip__status";
    const preview = this.document.createElement("span");
    preview.className = "crisp-asr-live-strip__preview";
    const timer = this.document.createElement("span");
    timer.className = "crisp-asr-live-strip__timer";
    main.append(pulse, status, preview, timer);

    const stop = this.document.createElement("button");
    stop.type = "button";
    stop.className = "crisp-asr-live-strip__stop";
    stop.textContent = "结束并写入";
    stop.addEventListener("click", (event) => {
      event.stopPropagation();
      this.actions.onStop();
    });

    root.append(main, stop);
    this.document.body.append(root);
    this.root = root;
    this.status = status;
    this.preview = preview;
    this.timer = timer;
    this.stopButton = stop;
  }
}
