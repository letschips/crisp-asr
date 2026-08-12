// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { CrispAsrSettingTab } from "../src/settings-tab";

function installObsidianElementHelpers(): void {
  const prototype = HTMLElement.prototype as unknown as Record<
    string,
    unknown
  >;
  prototype.empty = function empty(this: HTMLElement): void {
    this.replaceChildren();
  };
  prototype.addClass = function addClass(
    this: HTMLElement,
    ...classes: string[]
  ): void {
    this.classList.add(...classes);
  };
  prototype.createDiv = function createDiv(
    this: HTMLElement,
    options?: { cls?: string },
  ): HTMLDivElement {
    const element = this.ownerDocument.createElement("div");
    if (options?.cls) {
      element.className = options.cls;
    }
    this.append(element);
    return element;
  };
  prototype.createEl = function createEl(
    this: HTMLElement,
    tag: string,
    options?: {
      text?: string;
      cls?: string;
      href?: string;
      attr?: Record<string, string>;
    },
  ): HTMLElement {
    const element = this.ownerDocument.createElement(tag);
    if (options?.text) {
      element.textContent = options.text;
    }
    if (options?.cls) {
      element.className = options.cls;
    }
    if (options?.href) {
      element.setAttribute("href", options.href);
    }
    if (options?.attr) {
      for (const [key, value] of Object.entries(options.attr)) {
        element.setAttribute(key, String(value));
      }
    }
    this.append(element);
    return element;
  };
}

function plugin(): Record<string, unknown> {
  return {
    settings: {
      apiKeySecretName: "speech-key",
      liveResourceId: "volc.seedasr.sauc.duration",
      aiProvider: "anthropic",
      aiApiKeySecretName: "claude-key",
      aiModel: "claude-model",
      aiBaseUrl: "",
      aiOutputMode: "same-note",
      customPrompt: "按 {{transcript}} 整理",
      microphoneDeviceId: "default",
      saveLiveAudio: false,
      liveAudioFolder: "Crisp ASR/Audio",
      silenceAction: "warn",
      silenceDurationSeconds: 60,
      autoTranscribeRecordings: false,
      autoTranscribeScope: "recording",
      autoTranscribeFolder: "",
      outputMode: "sidecar",
      outputFolder: "Crisp ASR",
    },
    uiState: {
      microphones: [{ deviceId: "default", label: "系统默认" }],
    },
    saveSettings: async () => undefined,
    testConnection: async () => undefined,
    testAiConnection: async () => undefined,
    setMicrophoneDevice: async () => undefined,
    setSaveLiveAudio: async () => undefined,
    refreshMicrophones: async () => undefined,
  };
}

describe("AI text processing settings", () => {
  beforeEach(() => {
    installObsidianElementHelpers();
    document.body.replaceChildren();
  });

  it("offers provider, secret, model, output and custom prompt controls", () => {
    const tab = new CrispAsrSettingTab({} as never, plugin() as never);

    tab.display();

    expect(tab.containerEl.textContent).toContain("AI 文本处理");
    expect(tab.containerEl.textContent).toContain("火山方舟");
    expect(tab.containerEl.textContent).toContain("OpenAI");
    expect(tab.containerEl.textContent).toContain("Claude");
    expect(tab.containerEl.textContent).toContain("DeepSeek");
    expect(tab.containerEl.textContent).toContain("自定义兼容接口");
    expect(tab.containerEl.textContent).toContain("AI API Key");
    expect(tab.containerEl.textContent).toContain("AI 模型");
    expect(tab.containerEl.textContent).toContain("结果写入方式");
    expect(tab.containerEl.querySelector<HTMLTextAreaElement>("textarea.crisp-asr-custom-prompt")?.value).toBe(
      "按 {{transcript}} 整理",
    );
  });

  it("shows a Base URL control only for the custom provider", () => {
    const custom = plugin();
    (custom.settings as Record<string, unknown>).aiProvider = "custom";
    (custom.settings as Record<string, unknown>).aiBaseUrl =
      "https://llm.example.com/v1";
    const tab = new CrispAsrSettingTab({} as never, custom as never);

    tab.display();

    const names = Array.from(
      tab.containerEl.querySelectorAll(".setting-item-name"),
    ).map((element) => element.textContent);
    expect(names).toContain("Base URL");
    const baseUrlSetting = Array.from(
      tab.containerEl.querySelectorAll<HTMLElement>(".setting-item"),
    ).find((element) =>
      element.querySelector(".setting-item-name")?.textContent === "Base URL"
    );
    expect(
      baseUrlSetting?.querySelector<HTMLInputElement>("input")?.value,
    ).toBe("https://llm.example.com/v1");
  });

  it("shows the iPhone shortcut QR download entry", () => {
    const tab = new CrispAsrSettingTab({} as never, plugin() as never);

    tab.display();

    const qrSetting = Array.from(
      tab.containerEl.querySelectorAll<HTMLElement>(".setting-item"),
    ).find((element) =>
      element.querySelector(".setting-item-name")?.textContent
        === "获取 iPhone 快捷指令"
    );
    expect(qrSetting).toBeDefined();
    expect(qrSetting?.querySelector("a")?.getAttribute("href")).toBe(
      "https://www.icloud.com/shortcuts/b5c18553917b4f96bb302f88ccb2f0d4",
    );
    expect(qrSetting?.querySelector("img")).not.toBeNull();
  });

  it("offers silence strategy and duration controls", () => {
    const tab = new CrispAsrSettingTab({} as never, plugin() as never);

    tab.display();

    expect(tab.containerEl.textContent).toContain("静音保护");
    expect(tab.containerEl.textContent).toContain("仅提醒");
    expect(tab.containerEl.textContent).toContain("自动结束并写入");
    expect(tab.containerEl.textContent).toContain("60 秒");
  });
});
