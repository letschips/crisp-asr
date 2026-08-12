import { Modal, Notice, type App } from "obsidian";

export class SpeakerRenameModal extends Modal {
  constructor(
    app: App,
    private readonly speakers: readonly number[],
    private readonly applyNames: (names: Record<number, string>) => Promise<void>,
  ) { super(app); }

  onOpen(): void {
    this.titleEl.textContent = "重命名说话人";
    const inputs = new Map<number, HTMLInputElement>();
    for (const speaker of this.speakers) {
      const row = this.contentEl.createDiv({ cls: "crisp-asr-speaker-rename__row" });
      row.createEl("label", { text: `说话人 ${speaker}` });
      const input = row.createEl("input", { type: "text", placeholder: "输入姓名或角色" });
      inputs.set(speaker, input);
    }
    const actions = this.contentEl.createDiv({ cls: "crisp-asr-smart-modal__actions" });
    const cancel = actions.createEl("button", { text: "取消" });
    cancel.addEventListener("click", () => this.close());
    const save = actions.createEl("button", { text: "保存", cls: "mod-cta" });
    save.addEventListener("click", () => {
      const names: Record<number, string> = {};
      for (const [speaker, input] of inputs) if (input.value.trim()) names[speaker] = input.value.trim();
      save.disabled = true;
      void this.applyNames(names).then(() => {
        new Notice("Crisp ASR：说话人名称已更新");
        this.close();
      }).catch((error) => {
        save.disabled = false;
        new Notice(`Crisp ASR：重命名失败：${error instanceof Error ? error.message : String(error)}`, 8_000);
      });
    });
  }

  onClose(): void { this.contentEl.empty(); }
}
