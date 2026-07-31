// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { TFile } from "obsidian";
import CrispAsrPlugin from "../src/main";
import { DEFAULT_SETTINGS } from "../src/settings";

function transcriptFile(): TFile {
  const file = new TFile();
  file.path = "Crisp ASR/interview.md";
  file.name = "interview.md";
  file.basename = "interview";
  file.extension = "md";
  return file;
}

describe("plugin smart processing workflow", () => {
  it("previews a provider result and writes only the generated section", async () => {
    const file = transcriptFile();
    const original = `# Interview

## 转写正文

嗯，我们明天上午十点交付。

## 时间轴

- 00:00 原文
`;
    let markdown = original;
    const app = {
      workspace: {
        containerEl: document.body,
        getActiveFile: () => file,
        getLeaf: () => ({
          openFile: async () => undefined,
        }),
      },
      vault: {
        cachedRead: async () => markdown,
        process: async (
          _file: TFile,
          update: (content: string) => string,
        ) => {
          markdown = update(markdown);
        },
        getAbstractFileByPath: (path: string) =>
          path === file.path ? file : null,
      },
      secretStorage: {
        getSecret: () => "test-secret",
      },
    };
    const plugin = new CrispAsrPlugin(
      app as never,
      { id: "crisp-asr" } as never,
    );
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      aiApiKeySecretName: "ai-test",
      aiModel: "test-model",
    };
    plugin.ensureLicenseActivated = async () => true;
    plugin.uiState.smartTargetPath = file.path;
    (
      plugin as unknown as {
        sendAiHttpRequest: () => Promise<unknown>;
      }
    ).sendAiHttpRequest = async () => ({
      status: 200,
      json: {
        choices: [{
          message: { content: "我们明天上午十点交付。" },
        }],
      },
      text: "",
    });

    await plugin.startSmartProcessing("polish");
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    const modal = (
      plugin as unknown as {
        smartModal: { contentEl: HTMLElement };
      }
    ).smartModal;
    expect(
      modal.contentEl.querySelector(".crisp-asr-smart-preview__original")
        ?.textContent,
    ).toContain("嗯，我们明天上午十点交付。");
    expect(
      modal.contentEl.querySelector(".crisp-asr-smart-preview__result")
        ?.textContent,
    ).toContain("我们明天上午十点交付。");

    const write = Array.from(
      modal.contentEl.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "写入笔记");
    write?.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(markdown).toContain("## 智能整理");
    expect(markdown).toContain("我们明天上午十点交付。");
    expect(markdown.slice(markdown.indexOf("## 转写正文"))).toBe(
      original.slice(original.indexOf("## 转写正文")),
    );
  });
});
