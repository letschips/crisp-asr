export type DictationProfileId =
  | "free"
  | "idea"
  | "article"
  | "video"
  | "xiaohongshu"
  | "meeting"
  | "custom";

export interface DictationProfile {
  id: DictationProfileId;
  name: string;
  description: string;
  context: string;
  creationInstruction: string;
}

export const DICTATION_PROFILES: readonly DictationProfile[] = [
  {
    id: "free",
    name: "自由口述",
    description: "忠实记录，不预设内容结构",
    context: "个人自由口述，可能包含灵感、观点和待办。",
    creationInstruction: "整理为忠实、清晰、可继续编辑的个人笔记。",
  },
  {
    id: "idea",
    name: "灵感速记",
    description: "捕捉观点、问题和下一步",
    context: "个人灵感速记，重点识别观点、问题、例子和下一步行动。",
    creationInstruction: "整理为核心想法、论据、待验证问题和下一步行动。",
  },
  {
    id: "article",
    name: "长文创作",
    description: "从口述形成结构化文章初稿",
    context: "作者正在口述一篇长文，内容包含主题、论点、案例和结论。",
    creationInstruction: "生成有开头、逻辑层次、案例和结尾的长文初稿，保留作者观点。",
  },
  {
    id: "video",
    name: "视频口播稿",
    description: "形成自然、有节奏的口播文本",
    context: "内容创作者正在口述视频脚本，可能包含钩子、观点、案例和结尾引导。",
    creationInstruction: "生成自然口语化的视频口播稿，强化开头钩子和段落节奏。",
  },
  {
    id: "xiaohongshu",
    name: "小红书内容",
    description: "形成有钩子和阅读节奏的内容草稿",
    context: "内容创作者正在口述小红书内容，可能包含痛点、经验、方法和行动建议。",
    creationInstruction: "生成有吸引力开头、清晰正文和自然收尾的小红书草稿，避免虚假夸张。",
  },
  {
    id: "meeting",
    name: "会议 / 访谈",
    description: "保留发言归属、结论和行动项",
    context: "多人会议或访谈，重点识别人名、角色、结论、分歧、行动项和时间节点。",
    creationInstruction: "生成会议或访谈纪要，保留说话人归属、结论、行动项和待确认问题。",
  },
  {
    id: "custom",
    name: "自定义",
    description: "使用自定义场景和创作要求",
    context: "",
    creationInstruction: "",
  },
];

export function normalizeDictationProfileId(value: unknown): DictationProfileId {
  return DICTATION_PROFILES.some((profile) => profile.id === value)
    ? value as DictationProfileId
    : "free";
}

export function resolveDictationProfile(input: {
  id: DictationProfileId;
  customName?: string;
  customContext?: string;
  customInstruction?: string;
}): DictationProfile {
  const profile = DICTATION_PROFILES.find((item) => item.id === input.id)
    ?? DICTATION_PROFILES[0];
  if (profile.id !== "custom") {
    return profile;
  }
  return {
    ...profile,
    name: input.customName?.trim() || "自定义口述",
    context: input.customContext?.trim() || "个人自定义口述场景。",
    creationInstruction: input.customInstruction?.trim()
      || "按照用户的自定义要求整理为可继续编辑的内容。",
  };
}
