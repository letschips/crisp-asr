import { describe, expect, it, vi } from "vitest";
import { runCreationWorkflow } from "../src/creation-workflow";
import { DICTATION_PROFILES } from "../src/dictation-profile";

describe("creation workflow", () => {
  it("runs four sequential stages and returns a staged preview", async () => {
    const generate = vi.fn(async ({ userPrompt }: { userPrompt: string }) => `结果 ${userPrompt.length}`);
    const profile = DICTATION_PROFILES.find((item) => item.id === "article")!;
    const result = await runCreationWorkflow({ transcript: "一段口述", profile, generate });
    expect(generate).toHaveBeenCalledTimes(4);
    expect(result).toContain("## 净化原文");
    expect(result).toContain("## 标题与钩子");
  });
});
