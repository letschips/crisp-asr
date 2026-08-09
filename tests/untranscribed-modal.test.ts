// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  filterUntranscribedCandidates,
  UntranscribedAudioModal,
} from "../src/untranscribed-modal";

describe("filterUntranscribedCandidates", () => {
  it("returns all candidates for an empty query", () => {
    expect(filterUntranscribedCandidates(["a.m4a", "b.mp3"], ""))
      .toEqual(["a.m4a", "b.mp3"]);
  });

  it("filters case-insensitively by path", () => {
    expect(filterUntranscribedCandidates(
      ["录音/A.m4a", "其他/b.mp3"],
      "a",
    )).toEqual(["录音/A.m4a"]);
  });
});

describe("UntranscribedAudioModal", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("renders candidates and confirms the selected subset", () => {
    let confirmed: string[] | null = null;
    const modal = new UntranscribedAudioModal(
      {} as never,
      ["录音/a.m4a", "录音/b.mp3", "录音/c.mp3"],
      (paths) => {
        confirmed = paths;
      },
    );

    modal.open();

    const checkboxes = modal.contentEl.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(checkboxes).toHaveLength(3);
    for (const index of [1, 2]) {
      const checkbox = checkboxes[index];
      if (checkbox) {
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event("change"));
      }
    }
    expect(
      modal.contentEl.querySelector(".crisp-asr-scan-modal__footer")
        ?.textContent,
    ).toContain("已选 2 个");
    const confirm = [...modal.contentEl.querySelectorAll("button")]
      .find((button) => button.textContent === "转写所选");
    confirm?.click();
    expect(confirmed).toEqual(["录音/b.mp3", "录音/c.mp3"]);
  });

  it("filters the list while searching", () => {
    const modal = new UntranscribedAudioModal(
      {} as never,
      ["录音/a.m4a", "录音/b.mp3"],
      () => undefined,
    );

    modal.open();

    const search = modal.contentEl.querySelector<HTMLInputElement>(
      ".crisp-asr-scan-modal__search",
    );
    expect(search).not.toBeNull();
    if (search) {
      search.value = "b";
      search.dispatchEvent(new Event("input"));
    }
    expect(
      modal.contentEl.querySelectorAll(".crisp-asr-scan-modal__row"),
    ).toHaveLength(1);
  });

  it("creates every control in the modal owner document", () => {
    const ownerDocument = document.implementation.createHTMLDocument(
      "ASR popout",
    );
    const modal = new UntranscribedAudioModal(
      {} as never,
      ["录音/a.m4a"],
      () => undefined,
    );
    modal.contentEl = ownerDocument.createElement("div");

    modal.onOpen();

    for (const element of modal.contentEl.querySelectorAll("*")) {
      expect(element.ownerDocument).toBe(ownerDocument);
    }
  });
});
