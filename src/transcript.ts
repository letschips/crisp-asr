export interface TranscriptUtterance {
  text: string;
  start_time: number;
  end_time: number;
  definite: boolean;
}

export interface TranscriptResult {
  text: string;
  utterances?: TranscriptUtterance[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function extractTranscriptResult(payload: unknown): TranscriptResult {
  const root = asRecord(payload);
  const resultValue = Array.isArray(root.result) ? root.result[0] : root.result;
  const result = asRecord(resultValue);
  const text = typeof result.text === "string" ? result.text.trim() : "";
  const utterances = Array.isArray(result.utterances)
    ? result.utterances.map((value): TranscriptUtterance | null => {
      const item = asRecord(value);
      const utteranceText = typeof item.text === "string"
        ? item.text.trim()
        : "";
      if (utteranceText.length === 0) {
        return null;
      }
      return {
        text: utteranceText,
        start_time: typeof item.start_time === "number" ? item.start_time : 0,
        end_time: typeof item.end_time === "number" ? item.end_time : 0,
        definite: item.definite === true,
      };
    }).filter((item): item is TranscriptUtterance => item !== null)
    : [];
  return { text, utterances };
}

export class TranscriptAccumulator {
  private readonly finalized = new Map<string, TranscriptUtterance>();
  private sortedCache: TranscriptUtterance[] = [];
  private cacheValid = false;
  private previewText = "";

  consume(result: TranscriptResult): {
    added: TranscriptUtterance[];
    preview: string;
  } {
    const utterances = result.utterances ?? [];
    const interim = utterances
      .filter((utterance) => !utterance.definite)
      .map((utterance) => utterance.text.trim())
      .filter((text) => text.length > 0)
      .join("\n");
    this.previewText = utterances.length > 0
      ? interim
      : result.text?.trim() ?? "";
    const added: TranscriptUtterance[] = [];
    for (const utterance of utterances) {
      if (!utterance.definite || utterance.text.trim().length === 0) {
        continue;
      }
      const key = [
        utterance.start_time,
        utterance.end_time,
        utterance.text.trim(),
      ].join(":");
      if (this.finalized.has(key)) {
        continue;
      }
      const normalized = {
        ...utterance,
        text: utterance.text.trim(),
        definite: true,
      };
      this.finalized.set(key, normalized);
      added.push(normalized);
    }
    if (added.length > 0) {
      this.cacheValid = false;
    }
    return { added, preview: this.previewText };
  }

  finalText(): string {
    const text = this.utterances()
      .map((utterance) => utterance.text)
      .join("\n")
      .trim();
    return text || this.previewText;
  }

  utterances(): TranscriptUtterance[] {
    if (!this.cacheValid) {
      this.sortedCache = [...this.finalized.values()].sort((left, right) =>
        left.start_time - right.start_time
        || left.end_time - right.end_time
      );
      this.cacheValid = true;
    }
    return this.sortedCache;
  }
}

export function formatTimestamp(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor(totalSeconds % 3_600 / 60);
  const seconds = totalSeconds % 60;
  const paddedMinutes = String(minutes).padStart(2, "0");
  const paddedSeconds = String(seconds).padStart(2, "0");
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${paddedMinutes}:${paddedSeconds}`
    : `${paddedMinutes}:${paddedSeconds}`;
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function renderTranscriptNote(input: {
  title: string;
  sourcePath: string;
  createdAt: string;
  text: string;
  utterances: TranscriptUtterance[];
  logId?: string;
}): string {
  const timeline = input.utterances.length > 0
    ? input.utterances.map((utterance) =>
      `- \`${formatTimestamp(utterance.start_time)}\` ${utterance.text}`
    ).join("\n")
    : input.text.split(/\n+/).map((line) => `- ${line}`).join("\n");
  const logId = input.logId
    ? `log_id: ${input.logId.replace(/[^a-zA-Z0-9_-]/g, "")}\n`
    : "";
  return `---
type: Note
source_audio: ${yamlString(`[[${input.sourcePath}]]`)}
created: ${yamlString(input.createdAt)}
asr_provider: Doubao
asr_status: Completed
${logId}---

# ${input.title}

![[${input.sourcePath}]]

## 转写正文

${input.text.trim()}

## 时间轴

${timeline}
`;
}

export function renderLiveTranscriptBlock(input: {
  startedAt: string;
  text: string;
  utterances: TranscriptUtterance[];
  audioPath?: string;
}): string {
  const date = input.startedAt.slice(0, 16).replace("T", " ");
  const audio = input.audioPath ? `![[${input.audioPath}]]\n\n` : "";
  return `\n\n## 实时转写 · ${date}\n\n${audio}${input.text.trim()}\n`;
}
