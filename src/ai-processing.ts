export type AiProcessMode = "polish" | "extract" | "custom";

export interface ProcessingMetadata {
  title?: string;
  date?: string;
  audioFile?: string;
  duration?: string;
}

export interface ProcessingPrompts {
  systemPrompt: string;
  userPrompt: string;
}

export interface BuildProcessingPromptInput {
  mode: AiProcessMode;
  transcript: string;
  customPrompt?: string;
  metadata?: ProcessingMetadata;
}

export class AiProcessingCancelledError extends Error {
  constructor() {
    super("AI 处理已取消");
    this.name = "AiProcessingCancelledError";
  }
}

const SHARED_ACCURACY_RULES = `你正在处理一份语音识别转写。
只能依据原始转写进行处理，不得虚构、补充或猜测原文中没有的事实。
必须准确保留人名、专有名词、数字、金额、日期、时间、结论和行动责任。
遇到无法确认的内容时保留原意，并明确标记为不确定。
只输出处理后的正文，不要解释你的工作过程。`;

const POLISH_RULES = `${SHARED_ACCURACY_RULES}
任务是保真润色：修正明显的语音识别错别字、标点和分段，删除无意义的语气词与机械重复。
不得删减有效信息，不得概括，不得改变说话者的观点、语气和事实含义。
使用清晰自然的 Markdown 段落。`;

const EXTRACT_RULES = `${SHARED_ACCURACY_RULES}
任务是重点提炼：删除无意义口头语、反复表达和偏离主题的片段，只保留有价值的信息。
优先提取关键观点、事实、结论、决定、行动项、负责人、时间节点和待确认问题。
使用简洁、层次清楚的 Markdown；没有行动项时不要凭空生成。`;

const CUSTOM_RULES = `${SHARED_ACCURACY_RULES}
严格执行用户提供的自定义处理要求；如果自定义要求与事实准确或原文保护冲突，以事实准确和原文保护为准。`;

function lastReadableBoundary(value: string, minimum: number): number {
  const candidates = [
    value.lastIndexOf("\n\n"),
    value.lastIndexOf("\n"),
    Math.max(
      value.lastIndexOf("。"),
      value.lastIndexOf("！"),
      value.lastIndexOf("？"),
      value.lastIndexOf(". "),
      value.lastIndexOf("! "),
      value.lastIndexOf("? "),
    ),
  ];
  const boundary = Math.max(...candidates);
  if (boundary < minimum) {
    return -1;
  }
  const token = value.slice(boundary, boundary + 2);
  return token === "\n\n" || token.endsWith(" ")
    ? boundary + 2
    : boundary + 1;
}

export function splitTranscript(
  transcript: string,
  maxChars = 12_000,
): string[] {
  if (!Number.isFinite(maxChars) || maxChars < 1) {
    throw new Error("maxChars 必须大于 0");
  }
  if (transcript.length <= maxChars) {
    return transcript ? [transcript] : [];
  }
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < transcript.length) {
    let end = Math.min(cursor + maxChars, transcript.length);
    if (end < transcript.length) {
      const window = transcript.slice(cursor, end);
      const relative = lastReadableBoundary(
        window,
        Math.floor(maxChars * 0.45),
      );
      if (relative > 0) {
        end = cursor + relative;
      }
    }
    chunks.push(transcript.slice(cursor, end));
    cursor = end;
  }
  return chunks;
}

function replaceVariables(
  prompt: string,
  transcript: string,
  metadata: ProcessingMetadata,
): { prompt: string; usedTranscript: boolean } {
  const values: Record<string, string> = {
    transcript,
    title: metadata.title ?? "",
    date: metadata.date ?? "",
    audio_file: metadata.audioFile ?? "",
    duration: metadata.duration ?? "",
  };
  let usedTranscript = false;
  const expanded = prompt.replace(
    /\{\{(transcript|title|date|audio_file|duration)\}\}/g,
    (_match, key: keyof typeof values) => {
      if (key === "transcript") {
        usedTranscript = true;
      }
      return values[key];
    },
  );
  return { prompt: expanded, usedTranscript };
}

export function buildProcessingPrompts(
  input: BuildProcessingPromptInput,
): ProcessingPrompts {
  const transcript = input.transcript;
  if (!transcript.trim()) {
    throw new Error("原始转写为空，无法进行 AI 处理");
  }
  if (input.mode === "polish") {
    return {
      systemPrompt: POLISH_RULES,
      userPrompt: `请保真润色以下原始转写：\n\n${transcript}`,
    };
  }
  if (input.mode === "extract") {
    return {
      systemPrompt: EXTRACT_RULES,
      userPrompt: `请提炼以下原始转写的重点：\n\n${transcript}`,
    };
  }
  const customPrompt = input.customPrompt?.trim() ?? "";
  if (!customPrompt) {
    throw new Error("请先在 Crisp ASR 设置中填写自定义 Prompt");
  }
  const expanded = replaceVariables(
    customPrompt,
    transcript,
    input.metadata ?? {},
  );
  return {
    systemPrompt: CUSTOM_RULES,
    userPrompt: expanded.usedTranscript
      ? expanded.prompt
      : `${expanded.prompt}\n\n原始转写：\n${transcript}`,
  };
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AiProcessingCancelledError();
  }
}

export async function runAiProcessing(input: {
  mode: AiProcessMode;
  transcript: string;
  customPrompt?: string;
  metadata?: ProcessingMetadata;
  maxChunkChars?: number;
  generate: (prompts: ProcessingPrompts) => Promise<string>;
  onProgress?: (current: number, total: number, label: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const maxChunkChars = input.maxChunkChars ?? 12_000;
  const chunks = splitTranscript(input.transcript, maxChunkChars);
  if (chunks.length === 0) {
    throw new Error("原始转写为空，无法进行 AI 处理");
  }
  const needsMerge = input.mode === "extract" && chunks.length > 1;
  const total = chunks.length + (needsMerge ? 1 : 0);
  input.onProgress?.(0, total, "准备处理");
  const results: string[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    throwIfCancelled(input.signal);
    const prompts = buildProcessingPrompts({
      mode: input.mode,
      transcript: chunks[index] ?? "",
      customPrompt: input.customPrompt,
      metadata: input.metadata,
    });
    const result = await input.generate(prompts);
    throwIfCancelled(input.signal);
    results.push(result.trim());
    input.onProgress?.(
      index + 1,
      total,
      `正在整理 ${index + 1} / ${chunks.length}`,
    );
  }
  if (!needsMerge) {
    return results.filter(Boolean).join("\n\n").trim();
  }
  throwIfCancelled(input.signal);
  input.onProgress?.(chunks.length, total, "正在合并重点");
  const merged = await input.generate({
    systemPrompt: EXTRACT_RULES,
    userPrompt: `以下内容是同一份长转写的分段提炼结果。请合并重复内容，保留全部关键事实、结论、决定、行动项、负责人、时间节点和待确认问题，输出一份连贯的最终重点笔记：\n\n${
      results.join("\n\n---\n\n")
    }`,
  });
  throwIfCancelled(input.signal);
  input.onProgress?.(total, total, "重点提炼完成");
  return merged.trim();
}
