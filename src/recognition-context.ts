export interface RecognitionEnhancement {
  corpus?: {
    boosting_table_id?: string;
    context?: string;
  };
  enableSpeakerInfo?: boolean;
}

function cleanText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function parseHotwords(value: string, maxWords: number): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const line of value.split(/\r?\n|,/)) {
    const word = cleanText(line, 40);
    if (!word || seen.has(word)) {
      continue;
    }
    seen.add(word);
    words.push(word);
    if (words.length >= maxWords) {
      break;
    }
  }
  return words;
}

export function buildRecognitionEnhancement(input: {
  hotwordsText: string;
  boostingTableId: string;
  profileContext: string;
  noteContext?: string;
  live: boolean;
  identifySpeakers: boolean;
}): RecognitionEnhancement {
  const hotwords = parseHotwords(input.hotwordsText, input.live ? 50 : 5_000);
  const contextData = [input.noteContext, input.profileContext]
    .map((value) => cleanText(value ?? "", 2_400))
    .filter(Boolean)
    .map((text) => ({ text }));
  const context = hotwords.length > 0 || contextData.length > 0
    ? JSON.stringify({
      ...(hotwords.length > 0
        ? { hotwords: hotwords.map((word) => ({ word })) }
        : {}),
      ...(contextData.length > 0
        ? { context_type: "dialog_ctx", context_data: contextData }
        : {}),
    })
    : "";
  const boostingTableId = input.boostingTableId.trim();
  return {
    ...((context || boostingTableId)
      ? {
        corpus: {
          ...(boostingTableId ? { boosting_table_id: boostingTableId } : {}),
          ...(context ? { context } : {}),
        },
      }
      : {}),
    ...(input.identifySpeakers ? { enableSpeakerInfo: true } : {}),
  };
}

export function recognitionRequestFields(
  enhancement: RecognitionEnhancement | undefined,
  live: boolean,
): Record<string, unknown> {
  return {
    ...(enhancement?.corpus ? { corpus: enhancement.corpus } : {}),
    ...(enhancement?.enableSpeakerInfo
      ? {
        enable_speaker_info: true,
        ssd_version: "200",
        ...(live ? { enable_nonstream: true } : {}),
      }
      : {}),
  };
}
