import type { ProcessingPrompts } from "./ai-processing";
import type { DictationProfile } from "./dictation-profile";

const ACCURACY = "只能依据原始内容，不得虚构事实；保留人名、数字、日期、结论与不确定信息。只输出 Markdown 正文。";

export async function runCreationWorkflow(input: {
  transcript: string;
  profile: DictationProfile;
  customInstruction?: string;
  signal?: AbortSignal;
  onProgress?: (current: number, total: number, label: string) => void;
  generate: (prompts: ProcessingPrompts) => Promise<string>;
}): Promise<string> {
  const original = input.transcript.trim();
  if (!original) throw new Error("原始转写为空，无法开始创作");
  const steps = [
    ["净化原文", "修正标点、分段和明显识别错误，删除无意义口头语与机械重复，但不删有效信息。"],
    ["提取观点", "提取并有序组织关键观点、事实、例子、结论、行动项与待确认问题。"],
    ["生成初稿", `${input.profile.creationInstruction}${input.customInstruction?.trim() ? `\n补充要求：${input.customInstruction.trim()}` : ""}`],
    ["标题与钩子", "基于初稿生成 5 个准确、有吸引力但不夸大的标题，并给出一个开场钩子。"],
  ] as const;
  let material = original;
  const sections: string[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    if (input.signal?.aborted) throw new Error("AI 处理已取消");
    const [label, instruction] = steps[index]!;
    input.onProgress?.(index, steps.length, label);
    const result = (await input.generate({
      systemPrompt: `${ACCURACY}\n当前步骤：${label}。${instruction}`,
      userPrompt: `口述场景：${input.profile.name}\n\n待处理内容：\n${material}`,
    })).trim();
    if (!result) throw new Error(`${label}返回了空结果`);
    sections.push(`## ${label}\n\n${result}`);
    material = result;
    input.onProgress?.(index + 1, steps.length, `${label}完成`);
  }
  return sections.join("\n\n");
}
