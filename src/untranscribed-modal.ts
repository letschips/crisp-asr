import { App, Modal, Notice } from "obsidian";

function el(
  document: Document,
  tag: string,
  className = "",
  text?: string,
): HTMLElement {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

export function filterUntranscribedCandidates(
  candidates: readonly string[],
  query: string,
): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return [...candidates];
  }
  return candidates.filter((path) => path.toLowerCase().includes(normalized));
}

export class UntranscribedAudioModal extends Modal {
  private query = "";
  private selected = new Set<string>();
  private results: string[] = [];
  private listEl: HTMLElement | null = null;
  private footerEl: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly candidates: readonly string[],
    private readonly onConfirm: (paths: string[]) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    const document = contentEl.ownerDocument;
    contentEl.classList.add("crisp-asr-scan-modal");
    contentEl.append(el(document, "h3", "", "扫描未转写录音"));
    const search = el(
      document,
      "input",
      "crisp-asr-scan-modal__search",
    ) as HTMLInputElement;
    search.setAttribute("type", "search");
    search.setAttribute("placeholder", "搜索文件名…");
    search.addEventListener("input", () => {
      this.query = search.value;
      this.renderList();
    });
    const actions = el(document, "div", "crisp-asr-scan-modal__actions");
    const selectAll = el(document, "button", "", "全选");
    selectAll.addEventListener("click", () => {
      const allSelected = this.results.length > 0
        && this.results.every((path) => this.selected.has(path));
      for (const path of this.results) {
        if (allSelected) {
          this.selected.delete(path);
        } else {
          this.selected.add(path);
        }
      }
      this.renderList();
    });
    actions.append(selectAll);
    this.listEl = el(document, "div", "crisp-asr-scan-modal__list");
    this.footerEl = el(document, "p", "crisp-asr-scan-modal__footer");
    const confirm = el(document, "button", "mod-cta", "转写所选");
    confirm.addEventListener("click", () => {
      const paths = [...this.selected];
      if (paths.length === 0) {
        new Notice("请先勾选要转写的录音文件");
        return;
      }
      this.close();
      this.onConfirm(paths);
    });
    contentEl.append(search, actions, this.listEl, this.footerEl, confirm);
    this.renderList();
  }

  onClose(): void {
    this.contentEl.replaceChildren();
  }

  private renderList(): void {
    const list = this.listEl;
    if (!list) {
      return;
    }
    list.replaceChildren();
    const document = list.ownerDocument;
    this.results = filterUntranscribedCandidates(
      this.candidates,
      this.query,
    );
    for (const path of this.results) {
      const row = el(document, "label", "crisp-asr-scan-modal__row");
      const checkbox = el(document, "input") as HTMLInputElement;
      checkbox.setAttribute("type", "checkbox");
      checkbox.checked = this.selected.has(path);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          this.selected.add(path);
        } else {
          this.selected.delete(path);
        }
        this.updateFooter();
      });
      row.append(checkbox, el(document, "span", "", path));
      list.append(row);
    }
    this.updateFooter();
  }

  private updateFooter(): void {
    if (!this.footerEl) {
      return;
    }
    this.footerEl.textContent = `找到 ${this.results.length} 个未转写录音，已选 ${this.selected.size} 个`;
  }
}
