const SMART_START = "<!-- crisp-asr-ai:start -->";
const SMART_END = "<!-- crisp-asr-ai:end -->";

export interface TranscriptSection {
  heading: string;
  text: string;
  headingStart: number;
  sectionEnd: number;
}

export class SmartNoteConflictError extends Error {
  constructor() {
    super("原始转写在 AI 处理期间发生了变化，请重新生成");
    this.name = "SmartNoteConflictError";
  }
}

function cleanTranscriptBody(body: string): string {
  return body
    .split("\n")
    .filter((line) => !/^\s*!\[\[[^\]]+\]\]\s*$/.test(line))
    .join("\n")
    .trim();
}

export function extractLatestTranscript(
  markdown: string,
): TranscriptSection | null {
  const headingPattern =
    /^## (转写正文|音频转写(?:\s*·[^\n]*)?|实时转写(?:\s*·[^\n]*)?)\s*$/gm;
  const matches = [...markdown.matchAll(headingPattern)];
  const match = matches[matches.length - 1];
  if (!match || match.index === undefined) {
    return null;
  }
  const headingStart = match.index;
  const contentStart = headingStart + match[0].length;
  const nextHeading = /^##\s+/gm;
  nextHeading.lastIndex = contentStart;
  const next = nextHeading.exec(markdown);
  const sectionEnd = next?.index ?? markdown.length;
  return {
    heading: (match[1] ?? "").trim(),
    text: cleanTranscriptBody(markdown.slice(contentStart, sectionEnd)),
    headingStart,
    sectionEnd,
  };
}

function renderSmartBlock(result: string, modeLabel: string): string {
  return `${SMART_START}
## 智能整理

> 处理方式：${modeLabel}

${result.trim()}
${SMART_END}

`;
}

export function upsertSmartResult(
  markdown: string,
  expectedTranscript: string,
  result: string,
  modeLabel: string,
): string {
  const section = extractLatestTranscript(markdown);
  if (!section || section.text !== expectedTranscript) {
    throw new SmartNoteConflictError();
  }
  const block = renderSmartBlock(result, modeLabel);
  const before = markdown.slice(0, section.headingStart);
  const markerStart = before.lastIndexOf(SMART_START);
  const markerEnd = markerStart >= 0
    ? before.indexOf(SMART_END, markerStart)
    : -1;
  if (
    markerStart >= 0
    && markerEnd >= markerStart
    && before.slice(markerEnd + SMART_END.length).trim().length === 0
  ) {
    return markdown.slice(0, markerStart)
      + block
      + markdown.slice(section.headingStart);
  }
  return before + block + markdown.slice(section.headingStart);
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function renderSmartResultNote(input: {
  title: string;
  sourcePath: string;
  modeLabel: string;
  result: string;
  createdAt: string;
  provider: string;
  model: string;
}): string {
  return `---
type: Note
source_note: ${yamlString(`[[${input.sourcePath}]]`)}
created: ${yamlString(input.createdAt)}
ai_provider: ${yamlString(input.provider)}
ai_model: ${yamlString(input.model)}
---

# ${input.title}

> 来源：[[${input.sourcePath}]]
> 处理方式：${input.modeLabel}

## 智能整理

${input.result.trim()}
`;
}
