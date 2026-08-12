import { describe, expect, it } from "vitest";
import { normalizeLiveMarkers, renderMarkedTranscript } from "../src/live-markers";

describe("live markers", () => {
  it("renders semantic markers without changing spoken text", () => {
    const result = renderMarkedTranscript(["第一句", "第二句"], [
      { id: "1", type: "important", utteranceIndex: 0, atMs: 10 },
      { id: "2", type: "paragraph", utteranceIndex: 1, atMs: 20 },
      { id: "3", type: "question", utteranceIndex: 1, atMs: 30 },
    ]);
    expect(result).toContain("> [!important] 重点\n第一句");
    expect(result).toContain("> [!question] 待确认\n第二句");
  });

  it("drops malformed persisted markers", () => {
    expect(normalizeLiveMarkers([{ type: "bad" }, { type: "question", utteranceIndex: 2 }])).toHaveLength(1);
  });
});
