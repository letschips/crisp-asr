// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { CrispAsrLiveStrip } from "../src/live-strip";

describe("Crisp live strip", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("renders one reusable strip with the current status, timer, and preview", () => {
    const strip = new CrispAsrLiveStrip(document, {
      onOpen: () => undefined,
      onStop: () => undefined,
    });

    strip.update({
      mode: "listening",
      elapsed: "01:23",
      preview: "老师正在讲概率。",
    });
    strip.update({
      mode: "listening",
      elapsed: "01:24",
      preview: "老师正在讲条件概率。",
    });

    expect(document.querySelectorAll(".crisp-asr-live-strip")).toHaveLength(1);
    expect(document.querySelector(".crisp-asr-live-strip__status")?.textContent)
      .toBe("实时听写中");
    expect(document.querySelector(".crisp-asr-live-strip__timer")?.textContent)
      .toBe("01:24");
    expect(document.querySelector(".crisp-asr-live-strip__preview")?.textContent)
      .toBe("老师正在讲条件概率。");
  });

  it("routes the open and stop controls without mixing their actions", () => {
    let opened = 0;
    let stopped = 0;
    const strip = new CrispAsrLiveStrip(document, {
      onOpen: () => {
        opened += 1;
      },
      onStop: () => {
        stopped += 1;
      },
    });

    strip.update({ mode: "listening", elapsed: "00:08", preview: "" });
    document.querySelector<HTMLButtonElement>(
      ".crisp-asr-live-strip__main",
    )?.click();
    document.querySelector<HTMLButtonElement>(
      ".crisp-asr-live-strip__stop",
    )?.click();

    expect(opened).toBe(1);
    expect(stopped).toBe(1);
  });

  it("removes the strip when listening is no longer active", () => {
    const strip = new CrispAsrLiveStrip(document, {
      onOpen: () => undefined,
      onStop: () => undefined,
    });
    strip.update({ mode: "connecting", elapsed: "00:00", preview: "" });
    expect(document.querySelector(".crisp-asr-live-strip")).not.toBeNull();

    strip.update({ mode: "error", elapsed: "00:00", preview: "" });
    expect(document.querySelector(".crisp-asr-live-strip")).toBeNull();
  });
});
