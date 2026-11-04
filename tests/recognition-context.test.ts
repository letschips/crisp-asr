import { describe, expect, it } from "vitest";
import {
  buildRecognitionEnhancement,
  estimateAsrTokens,
  parseHotwords,
  recognitionRequestFields,
} from "../src/recognition-context";

describe("recognition enhancement", () => {
  it("deduplicates local terminology", () => {
    expect(parseHotwords("Obsidian\nCrisp ASR\nObsidian", 10))
      .toEqual(["Obsidian", "Crisp ASR"]);
  });

  it("builds documented corpus context and speaker fields", () => {
    const enhancement = buildRecognitionEnhancement({
      hotwordsText: "Obsidian\nCrisp ASR",
      boostingTableId: " table-1 ",
      profileContext: "正在口述长文",
      noteContext: "标题：语音创作",
      live: true,
      identifySpeakers: true,
    });
    expect(enhancement.corpus?.boosting_table_id).toBe("table-1");
    expect(JSON.parse(enhancement.corpus?.context ?? "{}")).toMatchObject({
      hotwords: [{ word: "Obsidian" }, { word: "Crisp ASR" }],
      context_type: "dialog_ctx",
      context_data: [
        { text: "标题：语音创作" },
        { text: "正在口述长文" },
      ],
    });
    expect(recognitionRequestFields(enhancement, true)).toMatchObject({
      enable_speaker_info: true,
      ssd_version: "200",
      enable_nonstream: true,
      corpus: { boosting_table_id: "table-1" },
    });
  });

  it("estimates CJK characters and Latin words as tokens", () => {
    expect(estimateAsrTokens("语音创作")).toBe(4);
    expect(estimateAsrTokens("Crisp ASR")).toBe(3);
    expect(estimateAsrTokens("")).toBe(0);
  });

  function contextOf(live: boolean, input: Partial<{
    hotwordsText: string; profileContext: string; noteContext: string;
  }>) {
    const enhancement = buildRecognitionEnhancement({
      hotwordsText: input.hotwordsText ?? "",
      boostingTableId: "",
      profileContext: input.profileContext ?? "",
      noteContext: input.noteContext,
      live,
      identifySpeakers: false,
    });
    return JSON.parse(enhancement.corpus?.context ?? "{}") as {
      hotwords?: Array<{ word: string }>;
      context_data?: Array<{ text: string }>;
    };
  }

  function contextTokens(ctx: ReturnType<typeof contextOf>): number {
    return [
      ...(ctx.hotwords ?? []).map((item) => item.word),
      ...(ctx.context_data ?? []).map((item) => item.text),
    ].reduce((sum, text) => sum + estimateAsrTokens(text), 0);
  }

  it("keeps live hotwords plus context within the 100-token streaming limit", () => {
    const ctx = contextOf(true, {
      hotwordsText: Array.from({ length: 50 }, (_, i) => `术语${i}`).join("\n"),
      profileContext: "正在口述长文".repeat(100),
      noteContext: "笔记正文".repeat(500),
    });
    expect(contextTokens(ctx)).toBeLessThanOrEqual(100);
    expect(ctx.hotwords?.[0]).toEqual({ word: "术语0" });
  });

  it("gives leftover live budget to the dictation profile before the note", () => {
    const ctx = contextOf(true, {
      hotwordsText: "Obsidian",
      profileContext: "正在口述长文",
      noteContext: "笔记正文".repeat(500),
    });
    expect(ctx.context_data?.map((item) => item.text)).toContain("正在口述长文");
    expect(contextTokens(ctx)).toBeLessThanOrEqual(100);
  });

  it("keeps file context_data within about 500 tokens but hotwords untouched", () => {
    const words = Array.from({ length: 300 }, (_, i) => `术语${i}`);
    const ctx = contextOf(false, {
      hotwordsText: words.join("\n"),
      profileContext: "正在口述长文",
      noteContext: "笔记正文".repeat(800),
    });
    expect(ctx.hotwords).toHaveLength(300);
    const dataTokens = (ctx.context_data ?? [])
      .reduce((sum, item) => sum + estimateAsrTokens(item.text), 0);
    expect(dataTokens).toBeLessThanOrEqual(500);
    expect(ctx.context_data?.map((item) => item.text)).toContain("正在口述长文");
  });
});
