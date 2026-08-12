import { describe, expect, it } from "vitest";
import {
  buildRecognitionEnhancement,
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
});
