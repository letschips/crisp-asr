import { describe, expect, it } from "vitest";
import {
  SerializedPersistence,
  normalizeLiveDraft,
  renderRecoveredTranscript,
  shouldCheckpointDraft,
} from "../src/live-draft";

describe("live transcript recovery", () => {
  const valid = {
    id: "draft-1",
    startedAt: "2026-08-12T08:00:00.000Z",
    targetPath: "Notes/idea.md",
    utterances: [
      {
        text: "这是已经确定的一句",
        start_time: 0,
        end_time: 1_200,
        definite: true,
      },
    ],
    preview: "还在说",
    updatedAt: 100,
  };

  it("normalizes valid drafts and rejects empty or malformed recovery data", () => {
    expect(normalizeLiveDraft(valid)).toEqual(valid);
    expect(normalizeLiveDraft({ ...valid, utterances: [], preview: "" })).toBeNull();
    expect(normalizeLiveDraft({ ...valid, id: "" })).toBeNull();
  });

  it("renders recovered content without losing finalized or preview text", () => {
    const content = renderRecoveredTranscript(valid);
    expect(content).toContain("恢复的实时转写");
    expect(content).toContain("这是已经确定的一句");
    expect(content).toContain("还在说");
  });

  it("checkpoints immediately at first and no more often than every ten seconds", () => {
    expect(shouldCheckpointDraft(0, 1_000)).toBe(true);
    expect(shouldCheckpointDraft(1_000, 10_999)).toBe(false);
    expect(shouldCheckpointDraft(1_000, 11_000)).toBe(true);
  });

  it("serializes immutable snapshots in request order", async () => {
    const writes: Array<{ value: number }> = [];
    const writer = new SerializedPersistence<{ value: number }>(async (value) => {
      await Promise.resolve();
      writes.push(value);
    });
    const state = { value: 1 };
    const first = writer.enqueue(state);
    state.value = 2;
    const second = writer.enqueue(state);
    state.value = 3;

    await Promise.all([first, second]);
    expect(writes).toEqual([{ value: 1 }, { value: 2 }]);
  });
});
