// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { SmartProcessingModal } from "../src/smart-modal";

describe("smart processing preview modal", () => {
  it("shows the untouched original beside the generated result before applying", async () => {
    const applied: string[] = [];
    const modal = new SmartProcessingModal({} as never, {
      title: "润色整理",
      original: "嗯，原始转写。",
      run: async ({ onProgress }) => {
        onProgress(1, 1, "整理完成");
        return "原始转写。";
      },
      apply: async (result) => {
        applied.push(result);
      },
    });

    await modal.onOpen();

    expect(modal.modalEl.classList.contains("crisp-asr-smart-modal")).toBe(
      true,
    );
    expect(
      modal.contentEl.querySelector(".crisp-asr-smart-preview__original")
        ?.textContent,
    ).toContain("嗯，原始转写。");
    expect(
      modal.contentEl.querySelector(".crisp-asr-smart-preview__result")
        ?.textContent,
    ).toContain("原始转写。");
    const apply = Array.from(
      modal.contentEl.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "写入笔记");
    apply?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(applied).toEqual(["原始转写。"]);
  });

  it("cancels the active processing controller without applying partial output", async () => {
    let aborted = false;
    let resolveRun: (value: string) => void = () => undefined;
    const modal = new SmartProcessingModal({} as never, {
      title: "重点提炼",
      original: "原始内容",
      run: ({ signal }) => new Promise((resolve) => {
        resolveRun = resolve;
        signal.addEventListener("abort", () => {
          aborted = true;
        });
      }),
      apply: async () => undefined,
    });

    const opening = modal.onOpen();
    await Promise.resolve();
    const cancel = Array.from(
      modal.contentEl.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "取消");
    cancel?.click();
    resolveRun("不应显示");
    await opening;

    expect(aborted).toBe(true);
    expect(
      (modal as unknown as { __closed: boolean }).__closed,
    ).toBe(true);
  });
});
