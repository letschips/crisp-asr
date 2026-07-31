import { describe, expect, it } from "vitest";
import {
  AiProcessingCancelledError,
  buildProcessingPrompts,
  runAiProcessing,
  splitTranscript,
} from "../src/ai-processing";

describe("AI transcript processing", () => {
  it("splits long transcripts at readable boundaries without losing characters", () => {
    const original = "第一段内容。\n\n第二段比较长，需要继续保留。\n第三段结束。";
    const chunks = splitTranscript(original, 12);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(original);
    expect(chunks.every((chunk) => chunk.length <= 12)).toBe(true);
  });

  it("builds distinct lossless polish and lossy extraction instructions", () => {
    const polish = buildProcessingPrompts({
      mode: "polish",
      transcript: "嗯，我们明天交付。",
      metadata: { title: "周会", date: "2026-07-30" },
    });
    const extract = buildProcessingPrompts({
      mode: "extract",
      transcript: "嗯，我们明天交付。",
      metadata: { title: "周会", date: "2026-07-30" },
    });

    expect(polish.systemPrompt).toContain("不得删减有效信息");
    expect(polish.systemPrompt).toContain("不得虚构");
    expect(polish.userPrompt).toContain("嗯，我们明天交付。");
    expect(extract.systemPrompt).toContain("只保留有价值的信息");
    expect(extract.systemPrompt).toContain("行动项");
  });

  it("expands custom prompt variables and appends the transcript when omitted", () => {
    const withVariable = buildProcessingPrompts({
      mode: "custom",
      transcript: "原始内容",
      customPrompt: "把 {{title}} 整理成清单：\n{{transcript}}",
      metadata: { title: "访谈", date: "2026-07-30" },
    });
    const withoutVariable = buildProcessingPrompts({
      mode: "custom",
      transcript: "另一段内容",
      customPrompt: "用三句话概括，日期 {{date}}。",
      metadata: { title: "随手记", date: "2026-07-30" },
    });

    expect(withVariable.userPrompt).toContain("把 访谈 整理成清单");
    expect(withVariable.userPrompt).toContain("原始内容");
    expect(withoutVariable.userPrompt).toContain("日期 2026-07-30");
    expect(withoutVariable.userPrompt).toContain("另一段内容");
  });

  it("processes every polish chunk, reports progress and keeps output order", async () => {
    const calls: string[] = [];
    const progress: string[] = [];
    const result = await runAiProcessing({
      mode: "polish",
      transcript: "甲乙丙丁戊己庚辛壬癸",
      maxChunkChars: 4,
      generate: async (prompts) => {
        calls.push(prompts.userPrompt);
        return `结果${calls.length}`;
      },
      onProgress: (current, total, label) => {
        progress.push(`${current}/${total}:${label}`);
      },
    });

    expect(calls).toHaveLength(3);
    expect(result).toBe("结果1\n\n结果2\n\n结果3");
    expect(progress).toEqual([
      "0/3:准备处理",
      "1/3:正在整理 1 / 3",
      "2/3:正在整理 2 / 3",
      "3/3:正在整理 3 / 3",
    ]);
  });

  it("runs a final consolidation pass for multi-chunk key extraction", async () => {
    const calls: string[] = [];
    const result = await runAiProcessing({
      mode: "extract",
      transcript: "甲乙丙丁戊己庚辛",
      maxChunkChars: 4,
      generate: async (prompts) => {
        calls.push(prompts.userPrompt);
        return calls.length <= 2 ? `分段重点${calls.length}` : "最终重点";
      },
    });

    expect(calls).toHaveLength(3);
    expect(calls[2]).toContain("分段重点1");
    expect(calls[2]).toContain("分段重点2");
    expect(result).toBe("最终重点");
  });

  it("stops between provider calls when the user cancels", async () => {
    const controller = new AbortController();
    let calls = 0;

    const promise = runAiProcessing({
      mode: "polish",
      transcript: "甲乙丙丁戊己庚辛",
      maxChunkChars: 4,
      signal: controller.signal,
      generate: async () => {
        calls += 1;
        controller.abort();
        return "第一段";
      },
    });

    await expect(promise).rejects.toBeInstanceOf(
      AiProcessingCancelledError,
    );
    expect(calls).toBe(1);
  });
});
