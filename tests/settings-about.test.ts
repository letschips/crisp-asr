// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderAboutCard } from "../src/settings-about";

describe("settings About card", () => {
  it("shows the plugin purpose and a safe external author link", () => {
    const container = document.createElement("div");

    renderAboutCard(
      container,
      "Crisp ASR",
      "把录音、麦克风和电脑声音安静地转写成 Obsidian 笔记。",
    );

    const card = container.querySelector(".crisp-asr-about");
    const author = card?.querySelector<HTMLAnchorElement>("a");
    expect(card?.querySelector("h3")?.textContent).toBe("About Crisp ASR");
    expect(card?.textContent).toContain(
      "把录音、麦克风和电脑声音安静地转写成 Obsidian 笔记。",
    );
    expect(author?.textContent).toBe("小红书 letschips");
    expect(author?.href).toBe("https://xhslink.cn/m/3MwtKu4822b");
    expect(author?.target).toBe("_blank");
    expect(author?.rel).toBe("noopener noreferrer");
  });
});
