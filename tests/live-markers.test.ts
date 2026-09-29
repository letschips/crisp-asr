import { describe, expect, it } from "vitest";
import { normalizeLiveMarkers, renderMarkedTranscript } from "../src/live-markers";

describe("live markers", () => {
  it("renders semantic markers without changing spoken text", () => {
    const result = renderMarkedTranscript(["第一句", "第二句"], [
      { id: "1", type: "important", utteranceIndex: 0, atMs: 10 },
      { id: "2", type: "paragraph", utteranceIndex: 1, atMs: 20 },
      { id: "3", type: "question", utteranceIndex: 1, atMs: 30 },
    ]);
    expect(result).toBe(
      "> [!important] 重点\n> 第一句\n\n> [!question] 待确认\n> 第二句",
    );
  });

  it("closes each callout so later sentences stay outside it", () => {
    const result = renderMarkedTranscript(["第一句", "第二句", "第三句", "第四句"], [
      { id: "1", type: "important", utteranceIndex: 1, atMs: 10 },
    ]);
    expect(result).toBe(
      "第一句\n\n> [!important] 重点\n> 第二句\n\n第三句\n第四句",
    );
  });

  it("merges important and question markers on the same sentence", () => {
    expect(renderMarkedTranscript(["一句"], [
      { id: "1", type: "important", utteranceIndex: 0, atMs: 10 },
      { id: "2", type: "question", utteranceIndex: 0, atMs: 20 },
    ])).toBe("> [!important] 重点 · 待确认\n> 一句");
  });

  it("keeps paragraph breaks without adding callouts", () => {
    expect(renderMarkedTranscript(["一", "二"], [
      { id: "1", type: "paragraph", utteranceIndex: 1, atMs: 10 },
    ])).toBe("一\n\n二");
  });

  it("drops malformed persisted markers", () => {
    expect(normalizeLiveMarkers([{ type: "bad" }, { type: "question", utteranceIndex: 2 }])).toHaveLength(1);
  });
});
