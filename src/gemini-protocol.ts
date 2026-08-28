import type { TranscriptUtterance } from "./transcript";
import { AsrServiceError } from "./service-error";

export interface GeminiFile {
  name: string;
  uri: string;
  mimeType: string;
  sizeBytes?: string;
  state?: string;
}

export interface GeminiTranscribeOptions {
  mode?: "smart" | "verbatim";
  identifySpeakers?: boolean;
  wordTimestamps?: boolean;
  customVocabulary?: string[];
  languageCode?: string;
}

export interface GeminiTranscribeResponse {
  text: string;
  utterances: TranscriptUtterance[];
  logId?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function buildGeminiInteractionBody(
  fileUri: string,
  mimeType: string,
  options?: GeminiTranscribeOptions,
): Record<string, unknown> {
  const isSmart = options?.mode !== "verbatim";
  const mode: Record<string, unknown> | string = isSmart
    ? "smart"
    : { type: "verbatim" };
  const transcriptionConfig: Record<string, unknown> = { mode };
  if (!isSmart) {
    if (options?.identifySpeakers) {
      (mode as Record<string, unknown>).diarization_mode = "speaker";
    }
    if (options?.wordTimestamps) {
      (mode as Record<string, unknown>).timestamp_granularities = ["word"];
    }
  }
  if (options?.customVocabulary && options.customVocabulary.length > 0) {
    transcriptionConfig.custom_vocabulary = options.customVocabulary.slice(0, 1_000);
  }
  if (options?.languageCode) {
    transcriptionConfig.language_codes = [options.languageCode];
  }
  return {
    model: "gemini-3.5-transcribe",
    input: [
      {
        type: "audio",
        uri: fileUri,
        mime_type: mimeType,
      },
    ],
    generation_config: {
      transcription_config: transcriptionConfig,
    },
  };
}

export function parseGeminiTranscribeResponse(
  json: unknown,
  status = 200,
): GeminiTranscribeResponse {
  const root = asRecord(json);

  // Check for an HTTP or service error before accepting an empty payload.
  if (root.error || status < 200 || status >= 300) {
    const errorObj = asRecord(root.error);
    const message = typeof errorObj.message === "string"
      ? errorObj.message
      : `HTTP ${status}`;
    const code = String(errorObj.code || status);
    const isRetryable = status === 429 || status >= 500 || code === "429";
    throw new AsrServiceError(`Gemini 转写失败: ${message}`, isRetryable, {
      code,
    });
  }

  // Parse output_text or output candidates
  let fullText = "";
  if (typeof root.output_text === "string") {
    fullText = root.output_text.trim();
  } else if (typeof root.text === "string") {
    fullText = root.text.trim();
  } else if (Array.isArray(root.candidates) && root.candidates.length > 0) {
    const candidate = asRecord(root.candidates[0]);
    const content = asRecord(candidate.content);
    if (Array.isArray(content.parts)) {
      fullText = content.parts
        .map((p) => {
          const rec = asRecord(p);
          return typeof rec.text === "string" ? rec.text : "";
        })
        .join("")
        .trim();
    }
  }

  const utterances: TranscriptUtterance[] = [];

  // Official detailed output is nested under steps[].content[].annotations[].
  if (Array.isArray(root.steps)) {
    for (const rawStep of root.steps) {
      const step = asRecord(rawStep);
      if (!Array.isArray(step.content)) continue;
      for (const rawContent of step.content) {
        const content = asRecord(rawContent);
        if (!fullText && typeof content.text === "string") {
          fullText = content.text.trim();
        }
        if (!Array.isArray(content.annotations)) continue;
        for (const rawAnnotation of content.annotations) {
          const annotation = asRecord(rawAnnotation);
          if (annotation.type !== "word_info") continue;
          const text = typeof annotation.text === "string"
            ? annotation.text.trim()
            : "";
          if (!text) continue;
          const speaker = typeof annotation.speaker === "string"
            ? annotation.speaker.trim()
            : "";
          utterances.push({
            text,
            start_time: typeof annotation.start_offset === "string"
              ? parseTimeStringToMs(annotation.start_offset)
              : 0,
            end_time: typeof annotation.end_offset === "string"
              ? parseTimeStringToMs(annotation.end_offset)
              : 0,
            definite: true,
            ...(speaker ? { speaker } : {}),
          });
        }
      }
    }
  }

  // Parse segments or utterances from structured result if available
  const segmentsList = Array.isArray(root.segments)
    ? root.segments
    : Array.isArray(root.utterances)
      ? root.utterances
      : null;

  if (utterances.length === 0 && segmentsList) {
    for (const item of segmentsList) {
      const seg = asRecord(item);
      const segText = typeof seg.text === "string" ? seg.text.trim() : "";
      if (!segText) continue;
      const startTime = typeof seg.start_time_ms === "number"
        ? seg.start_time_ms
        : typeof seg.start_time === "number"
          ? seg.start_time
          : typeof seg.startTime === "string"
            ? parseTimeStringToMs(seg.startTime)
            : 0;
      const endTime = typeof seg.end_time_ms === "number"
        ? seg.end_time_ms
        : typeof seg.end_time === "number"
          ? seg.end_time
          : typeof seg.endTime === "string"
            ? parseTimeStringToMs(seg.endTime)
            : 0;
      const speaker = seg.speaker !== undefined
        ? String(seg.speaker)
        : seg.speaker_id !== undefined
          ? String(seg.speaker_id)
          : undefined;

      utterances.push({
        text: segText,
        start_time: startTime,
        end_time: endTime,
        definite: true,
        ...(speaker ? { speaker } : {}),
      });
    }
  }

  // If no utterances were explicitly provided, synthesize from text lines or speaker format
  if (utterances.length === 0 && fullText.length > 0) {
    const lines = fullText.split(/\n+/).map((l) => l.trim()).filter((l) => l.length > 0);
    const speakerPattern = /^(?:Speaker|说话人)\s*(\d+|[A-Za-z0-9_-]+)[:：]\s*(.*)$/i;
    let fallbackTime = 0;
    for (const line of lines) {
      const match = line.match(speakerPattern);
      if (match) {
        utterances.push({
          text: match[2].trim(),
          start_time: fallbackTime,
          end_time: fallbackTime + 1_000,
          definite: true,
          speaker: match[1],
        });
      } else {
        utterances.push({
          text: line,
          start_time: fallbackTime,
          end_time: fallbackTime + 1_000,
          definite: true,
        });
      }
      fallbackTime += 1_000;
    }
  }

  const logId = typeof root.id === "string"
    ? root.id
    : typeof root.name === "string"
      ? root.name
      : undefined;
  const resolvedText = fullText || utterances.map((u) => u.text).join("\n");
  if (!resolvedText.trim()) {
    throw new AsrServiceError(
      "Gemini 转写失败: 服务返回了空结果",
      false,
      { code: "EMPTY_RESULT" },
    );
  }

  return {
    text: resolvedText,
    utterances,
    ...(logId ? { logId } : {}),
  };
}

function parseTimeStringToMs(timeStr: string): number {
  if (timeStr.endsWith("s")) {
    const seconds = Number.parseFloat(timeStr.slice(0, -1));
    return Number.isFinite(seconds) ? Math.floor(seconds * 1_000) : 0;
  }
  const numeric = Number.parseFloat(timeStr);
  return Number.isFinite(numeric) ? Math.floor(numeric * 1_000) : 0;
}
