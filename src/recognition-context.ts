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

/** Streaming ASR: hotwords plus context share about 100 tokens (Volcengine docs, 2026-11-03). */
const LIVE_CONTEXT_TOKEN_BUDGET = 100;
/** File (flash) ASR: context_data is kept to about 500 tokens (Volcengine docs, 2026-11-02). */
const FILE_CONTEXT_DATA_TOKEN_BUDGET = 500;

const CJK_CHAR = /[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/u;

/** Rough token count: one per CJK character, one per four Latin characters of a word. */
export function estimateAsrTokens(text: string): number {
  let tokens = 0;
  let latinRun = 0;
  const flush = () => {
    tokens += Math.ceil(latinRun / 4);
    latinRun = 0;
  };
  for (const char of text) {
    if (CJK_CHAR.test(char)) {
      flush();
      tokens += 1;
    } else if (/\s/u.test(char)) {
      flush();
    } else {
      latinRun += 1;
    }
  }
  flush();
  return tokens;
}

function takeWithinTokens(text: string, budget: number): string {
  if (budget <= 0) return "";
  if (estimateAsrTokens(text) <= budget) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (estimateAsrTokens(text.slice(0, mid)) <= budget) low = mid;
    else high = mid - 1;
  }
  return text.slice(0, low).trim();
}

export function buildRecognitionEnhancement(input: {
  hotwordsText: string;
  boostingTableId: string;
  profileContext: string;
  noteContext?: string;
  live: boolean;
  identifySpeakers: boolean;
}): RecognitionEnhancement {
  const parsedHotwords = parseHotwords(input.hotwordsText, input.live ? 50 : 5_000);
  let contextBudget = FILE_CONTEXT_DATA_TOKEN_BUDGET;
  let hotwords = parsedHotwords;
  if (input.live) {
    let remaining = LIVE_CONTEXT_TOKEN_BUDGET;
    hotwords = [];
    for (const word of parsedHotwords) {
      const cost = estimateAsrTokens(word);
      if (cost > remaining) break;
      hotwords.push(word);
      remaining -= cost;
    }
    contextBudget = remaining;
  }
  // The dictation profile is short and deliberate, so it gets the budget before the note.
  const profileText = takeWithinTokens(cleanText(input.profileContext, 2_400), contextBudget);
  const noteText = takeWithinTokens(
    cleanText(input.noteContext ?? "", 2_400),
    contextBudget - estimateAsrTokens(profileText),
  );
  const contextData = [noteText, profileText]
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
