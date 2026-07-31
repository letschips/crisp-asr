export class Plugin {
  app: unknown;
  manifest: unknown;
  __commands: Array<Record<string, unknown>> = [];
  __protocolHandlers = new Map<
    string,
    (params: Record<string, string>) => unknown
  >();

  constructor(app: unknown, manifest: unknown) {
    this.app = app;
    this.manifest = manifest;
  }

  async loadData(): Promise<unknown> {
    return {};
  }

  async saveData(): Promise<void> {}

  registerView(): void {}

  addRibbonIcon(): HTMLElement {
    return document.createElement("div");
  }

  addCommand(command: Record<string, unknown>): void {
    this.__commands.push(command);
  }

  addSettingTab(): void {}

  addStatusBarItem(): Record<string, () => void> {
    return {
      addClass: () => undefined,
      setText: () => undefined,
      show: () => undefined,
      hide: () => undefined,
    };
  }

  registerEvent(): void {}

  registerObsidianProtocolHandler(
    action: string,
    handler: (params: Record<string, string>) => unknown,
  ): void {
    this.__protocolHandlers.set(action, handler);
  }
}

export class PluginSettingTab {
  app: unknown;
  plugin: unknown;
  containerEl = document.createElement("div");

  constructor(app: unknown, plugin: unknown) {
    this.app = app;
    this.plugin = plugin;
  }
}

export class ItemView {
  contentEl = document.createElement("div");

  constructor(_leaf: unknown) {}
}

export class TFile {
  path = "";
  name = "";
  basename = "";
  extension = "";
}

export class MarkdownView {}
export class Notice {}

class TextComponent {
  inputEl: HTMLInputElement;

  constructor(container: HTMLElement) {
    this.inputEl = container.ownerDocument.createElement("input");
    container.append(this.inputEl);
  }

  setPlaceholder(value: string): this {
    this.inputEl.placeholder = value;
    return this;
  }

  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }

  onChange(callback: (value: string) => unknown): this {
    this.inputEl.addEventListener("input", () => {
      void callback(this.inputEl.value);
    });
    return this;
  }
}

class TextAreaComponent {
  inputEl: HTMLTextAreaElement;

  constructor(container: HTMLElement) {
    this.inputEl = container.ownerDocument.createElement("textarea");
    container.append(this.inputEl);
  }

  setPlaceholder(value: string): this {
    this.inputEl.placeholder = value;
    return this;
  }

  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }

  onChange(callback: (value: string) => unknown): this {
    this.inputEl.addEventListener("input", () => {
      void callback(this.inputEl.value);
    });
    return this;
  }
}

class DropdownComponent {
  selectEl: HTMLSelectElement;

  constructor(container: HTMLElement) {
    this.selectEl = container.ownerDocument.createElement("select");
    container.append(this.selectEl);
  }

  addOption(value: string, label: string): this {
    const option = this.selectEl.ownerDocument.createElement("option");
    option.value = value;
    option.textContent = label;
    this.selectEl.append(option);
    return this;
  }

  setValue(value: string): this {
    this.selectEl.value = value;
    return this;
  }

  onChange(callback: (value: string) => unknown): this {
    this.selectEl.addEventListener("change", () => {
      void callback(this.selectEl.value);
    });
    return this;
  }
}

class ButtonComponent {
  buttonEl: HTMLButtonElement;

  constructor(container: HTMLElement) {
    this.buttonEl = container.ownerDocument.createElement("button");
    container.append(this.buttonEl);
  }

  setButtonText(value: string): this {
    this.buttonEl.textContent = value;
    return this;
  }

  setIcon(value: string): this {
    this.buttonEl.dataset.icon = value;
    return this;
  }

  setTooltip(value: string): this {
    this.buttonEl.title = value;
    return this;
  }

  onClick(callback: () => unknown): this {
    this.buttonEl.addEventListener("click", () => {
      void callback();
    });
    return this;
  }
}

class ToggleComponent {
  toggleEl: HTMLInputElement;

  constructor(container: HTMLElement) {
    this.toggleEl = container.ownerDocument.createElement("input");
    this.toggleEl.type = "checkbox";
    container.append(this.toggleEl);
  }

  setValue(value: boolean): this {
    this.toggleEl.checked = value;
    return this;
  }

  onChange(callback: (value: boolean) => unknown): this {
    this.toggleEl.addEventListener("change", () => {
      void callback(this.toggleEl.checked);
    });
    return this;
  }
}

export class SecretComponent {
  selectEl: HTMLSelectElement;

  constructor(_app: unknown, container: HTMLElement) {
    this.selectEl = container.ownerDocument.createElement("select");
    this.selectEl.className = "secret-component";
    container.append(this.selectEl);
  }

  setValue(value: string): this {
    this.selectEl.dataset.value = value;
    return this;
  }

  onChange(callback: (value: string) => unknown): this {
    this.selectEl.addEventListener("change", () => {
      void callback(this.selectEl.value);
    });
    return this;
  }
}

export class Setting {
  settingEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;

  constructor(container: HTMLElement) {
    const document = container.ownerDocument;
    this.settingEl = document.createElement("div");
    this.settingEl.className = "setting-item";
    const info = document.createElement("div");
    info.className = "setting-item-info";
    this.nameEl = document.createElement("div");
    this.nameEl.className = "setting-item-name";
    this.descEl = document.createElement("div");
    this.descEl.className = "setting-item-description";
    info.append(this.nameEl, this.descEl);
    this.controlEl = document.createElement("div");
    this.controlEl.className = "setting-item-control";
    this.settingEl.append(info, this.controlEl);
    container.append(this.settingEl);
  }

  setName(value: string): this {
    this.nameEl.textContent = value;
    return this;
  }

  setDesc(value: string): this {
    this.descEl.textContent = value;
    return this;
  }

  addComponent(
    callback: (container: HTMLElement) => unknown,
  ): this {
    callback(this.controlEl);
    return this;
  }

  addText(callback: (component: TextComponent) => unknown): this {
    callback(new TextComponent(this.controlEl));
    return this;
  }

  addTextArea(callback: (component: TextAreaComponent) => unknown): this {
    callback(new TextAreaComponent(this.controlEl));
    return this;
  }

  addDropdown(callback: (component: DropdownComponent) => unknown): this {
    callback(new DropdownComponent(this.controlEl));
    return this;
  }

  addButton(callback: (component: ButtonComponent) => unknown): this {
    callback(new ButtonComponent(this.controlEl));
    return this;
  }

  addToggle(callback: (component: ToggleComponent) => unknown): this {
    callback(new ToggleComponent(this.controlEl));
    return this;
  }
}
export class Modal {
  app: unknown;
  containerEl = document.createElement("div");
  modalEl = document.createElement("div");
  titleEl = document.createElement("div");
  contentEl = document.createElement("div");
  __closed = false;

  constructor(app: unknown) {
    this.app = app;
    this.modalEl.append(this.titleEl, this.contentEl);
    this.containerEl.append(this.modalEl);
  }

  open(): void {
    void this.onOpen();
  }

  close(): void {
    this.__closed = true;
    this.onClose();
  }

  onOpen(): Promise<void> | void {}
  onClose(): void {}
}

export function normalizePath(path: string): string {
  return path;
}

export async function requestUrl(): Promise<never> {
  throw new Error("requestUrl is unavailable in unit tests");
}

export function setIcon(): void {}
