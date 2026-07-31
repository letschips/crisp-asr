import { describe, expect, it } from "vitest";
import {
  SmartNoteConflictError,
  extractLatestTranscript,
  renderSmartResultNote,
  upsertSmartResult,
} from "../src/smart-note";

const sidecar = `---
type: Note
---

# 访谈转写

![[Audio/interview.m4a]]

## 转写正文

嗯，我们明天上午十点交付。
预算是 12 万元。

## 时间轴

- \`00:00\` 嗯，我们明天上午十点交付。
`;

describe("smart transcript note safety", () => {
  it("extracts the latest ASR body and excludes audio embeds and timelines", () => {
    expect(extractLatestTranscript(sidecar)).toMatchObject({
      heading: "转写正文",
      text: "嗯，我们明天上午十点交付。\n预算是 12 万元。",
    });

    const currentNote = `# 工作记录

## 音频转写 · first

![[Audio/first.m4a]]

第一段。

## 实时转写 · 2026-07-30 10:00

![[Crisp ASR/Audio/live.webm]]

最新一段。
`;
    expect(extractLatestTranscript(currentNote)?.text).toBe("最新一段。");
  });

  it("inserts a marked smart section before the raw transcript without changing it", () => {
    const source = extractLatestTranscript(sidecar);
    if (!source) {
      throw new Error("fixture has no transcript");
    }

    const updated = upsertSmartResult(
      sidecar,
      source.text,
      "明天上午十点交付，预算 12 万元。",
      "重点提炼",
    );

    expect(updated.indexOf("## 智能整理")).toBeLessThan(
      updated.indexOf("## 转写正文"),
    );
    expect(updated).toContain("<!-- crisp-asr-ai:start -->");
    expect(updated).toContain("> 处理方式：重点提炼");
    expect(extractLatestTranscript(updated)?.text).toBe(source.text);
    expect(updated.slice(updated.indexOf("## 转写正文"))).toBe(
      sidecar.slice(sidecar.indexOf("## 转写正文")),
    );
  });

  it("replaces only the previous generated section on a second run", () => {
    const source = extractLatestTranscript(sidecar);
    if (!source) {
      throw new Error("fixture has no transcript");
    }
    const first = upsertSmartResult(sidecar, source.text, "第一次结果", "润色整理");
    const second = upsertSmartResult(first, source.text, "第二次结果", "重点提炼");

    expect(second).not.toContain("第一次结果");
    expect(second).toContain("第二次结果");
    expect(second.match(/<!-- crisp-asr-ai:start -->/g)).toHaveLength(1);
    expect(extractLatestTranscript(second)?.text).toBe(source.text);
  });

  it("refuses to write when the original transcript changed during generation", () => {
    const source = extractLatestTranscript(sidecar);
    if (!source) {
      throw new Error("fixture has no transcript");
    }
    const changed = sidecar.replace("预算是 12 万元", "预算是 15 万元");

    expect(() => upsertSmartResult(
      changed,
      source.text,
      "AI 结果",
      "润色整理",
    )).toThrow(SmartNoteConflictError);
  });

  it("renders a separate result note that links back without copying or replacing raw text", () => {
    const note = renderSmartResultNote({
      title: "访谈转写 · 智能整理",
      sourcePath: "Crisp ASR/访谈转写.md",
      modeLabel: "润色整理",
      result: "整理后的内容。",
      createdAt: "2026-07-30T10:00:00.000Z",
      provider: "anthropic",
      model: "claude-model",
    });

    expect(note).toContain('source_note: "[[Crisp ASR/访谈转写.md]]"');
    expect(note).toContain("## 智能整理");
    expect(note).toContain("整理后的内容。");
    expect(note).not.toContain("原始转写");
  });
});
