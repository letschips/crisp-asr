import type { TranscriptUtterance } from "./transcript";
import { normalizeLiveMarkers, type LiveMarker } from "./live-markers";
import { renderMarkedTranscript } from "./live-markers";

export interface PersistedLiveDraft {
  id: string;
  startedAt: string;
  targetPath: string | null;
  utterances: TranscriptUtterance[];
  preview: string;
  markers?: LiveMarker[];
  updatedAt: number;
}

function cleanUtterances(value: unknown): TranscriptUtterance[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): TranscriptUtterance[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const item = entry as Record<string, unknown>;
    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (!text) {
      return [];
    }
    return [{
      text,
      start_time: typeof item.start_time === "number" ? item.start_time : 0,
      end_time: typeof item.end_time === "number" ? item.end_time : 0,
      definite: true,
      ...(typeof item.speaker === "string" ? { speaker: item.speaker } : {}),
    }];
  });
}

export function normalizeLiveDraft(value: unknown): PersistedLiveDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const startedAt = typeof candidate.startedAt === "string"
    ? candidate.startedAt.trim()
    : "";
  const targetPath = typeof candidate.targetPath === "string"
    ? candidate.targetPath.trim() || null
    : null;
  const utterances = cleanUtterances(candidate.utterances);
  const preview = typeof candidate.preview === "string"
    ? candidate.preview.trim()
    : "";
  const updatedAt = typeof candidate.updatedAt === "number"
    && Number.isFinite(candidate.updatedAt)
    ? candidate.updatedAt
    : 0;
  if (!id || !startedAt || updatedAt <= 0 || (utterances.length === 0 && !preview)) {
    return null;
  }
  const markers = normalizeLiveMarkers(candidate.markers);
  return { id, startedAt, targetPath, utterances, preview, updatedAt, ...(markers.length ? { markers } : {}) };
}

export function renderRecoveredTranscript(draft: PersistedLiveDraft): string {
  const lines = [
    ...draft.utterances.map((utterance) => utterance.text),
    ...(draft.preview ? [draft.preview] : []),
  ];
  const text = renderMarkedTranscript(lines, draft.markers ?? []);
  const date = draft.startedAt.slice(0, 16).replace("T", " ");
  return `\n\n## 恢复的实时转写 · ${date}\n\n${text}\n`;
}

export function shouldCheckpointDraft(
  lastSavedAt: number,
  now: number,
  intervalMs = 10_000,
): boolean {
  return lastSavedAt === 0 || now - lastSavedAt >= intervalMs;
}

function cloneSnapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class SerializedPersistence<T> {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly save: (value: T) => Promise<void>) {}

  enqueue(value: T): Promise<void> {
    const snapshot = cloneSnapshot(value);
    const write = this.tail.then(() => this.save(snapshot));
    this.tail = write.catch(() => undefined);
    return write;
  }
}
