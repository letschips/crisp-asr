import { Modal, Notice, type App } from "obsidian";
import { AiProcessingCancelledError } from "./ai-processing";

interface SmartProcessingRunContext {
  signal: AbortSignal;
  onProgress: (current: number, total: number, label: string) => void;
}

interface SmartProcessingModalOptions {
  title: string;
  original: string;
  run: (context: SmartProcessingRunContext) => Promise<string>;
  apply: (result: string) => Promise<void>;
}

function createButton(
  container: HTMLElement,
  label: string,
  className: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = container.ownerDocument.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  container.append(button);
  return button;
}

export class SmartProcessingModal extends Modal {
  private controller: AbortController | null = null;
  private result = "";

  constructor(
    app: App,
    private readonly options: SmartProcessingModalOptions,
  ) {
    super(app);
  }

  async onOpen(): Promise<void> {
    this.modalEl.classList.add("crisp-asr-smart-modal");
    this.titleEl.textContent = this.options.title;
    await this.execute();
  }

  onClose(): void {
    this.controller?.abort();
    this.controller = null;
    this.contentEl.replaceChildren();
  }

  private async execute(): Promise<void> {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.renderProgress(0, 1, "准备处理");
    try {
      const result = await this.options.run({
        signal: controller.signal,
        onProgress: (current, total, label) => {
          if (!controller.signal.aborted) {
            this.renderProgress(current, total, label);
          }
        },
      });
      if (controller.signal.aborted) {
        return;
      }
      this.result = result.trim();
      this.renderPreview();
    } catch (error) {
      if (
        controller.signal.aborted
        || error instanceof AiProcessingCancelledError
      ) {
        this.close();
        return;
      }
      this.renderError(error);
    }
  }

  private renderProgress(
    current: number,
    total: number,
    label: string,
  ): void {
    const document = this.contentEl.ownerDocument;
    this.contentEl.replaceChildren();
    const progress = document.createElement("div");
    progress.className = "crisp-asr-smart-progress";
    const pulse = document.createElement("span");
    pulse.className = "crisp-asr-smart-progress__pulse";
    const info = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = label;
    const detail = document.createElement("span");
    detail.textContent = total > 1
      ? `${Math.min(current, total)} / ${total}`
      : "正在连接所选模型";
    info.append(heading, detail);
    progress.append(pulse, info);
    const actions = document.createElement("div");
    actions.className = "crisp-asr-smart-modal__actions";
    createButton(actions, "取消", "is-secondary", () => {
      this.controller?.abort();
      this.close();
    });
    this.contentEl.append(progress, actions);
  }

  private renderPreview(): void {
    const document = this.contentEl.ownerDocument;
    this.contentEl.replaceChildren();
    const hint = document.createElement("p");
    hint.className = "crisp-asr-smart-preview__hint";
    hint.textContent = "写入前请核对结果。原始转写不会被覆盖。";
    const preview = document.createElement("div");
    preview.className = "crisp-asr-smart-preview";
    const original = document.createElement("section");
    original.className = "crisp-asr-smart-preview__original";
    const originalTitle = document.createElement("strong");
    originalTitle.textContent = "原始转写";
    const originalBody = document.createElement("div");
    originalBody.textContent = this.options.original;
    original.append(originalTitle, originalBody);
    const result = document.createElement("section");
    result.className = "crisp-asr-smart-preview__result";
    const resultTitle = document.createElement("strong");
    resultTitle.textContent = "智能整理";
    const resultBody = document.createElement("div");
    resultBody.textContent = this.result;
    result.append(resultTitle, resultBody);
    preview.append(original, result);

    const actions = document.createElement("div");
    actions.className = "crisp-asr-smart-modal__actions";
    createButton(actions, "重新生成", "is-secondary", () => {
      void this.execute();
    });
    createButton(actions, "复制", "is-secondary", () => {
      void window.navigator.clipboard?.writeText(this.result)
        .then(() => new Notice("Crisp ASR：结果已复制"))
        .catch(() => new Notice("Crisp ASR：复制失败", 5_000));
    });
    createButton(actions, "放弃", "is-secondary", () => this.close());
    const apply = createButton(
      actions,
      "写入笔记",
      "is-primary",
      () => {
        apply.disabled = true;
        void this.options.apply(this.result)
          .then(() => this.close())
          .catch((error) => {
            apply.disabled = false;
            const message = error instanceof Error
              ? error.message
              : String(error);
            new Notice(`Crisp ASR 写入失败：${message}`, 8_000);
          });
      },
    );
    this.contentEl.append(hint, preview, actions);
  }

  private renderError(error: unknown): void {
    const document = this.contentEl.ownerDocument;
    this.contentEl.replaceChildren();
    const errorBox = document.createElement("div");
    errorBox.className = "crisp-asr-smart-error";
    const heading = document.createElement("strong");
    heading.textContent = "处理失败";
    const detail = document.createElement("p");
    detail.textContent = error instanceof Error ? error.message : String(error);
    errorBox.append(heading, detail);
    const actions = document.createElement("div");
    actions.className = "crisp-asr-smart-modal__actions";
    createButton(actions, "关闭", "is-secondary", () => this.close());
    createButton(actions, "重试", "is-primary", () => {
      void this.execute();
    });
    this.contentEl.append(errorBox, actions);
  }
}
