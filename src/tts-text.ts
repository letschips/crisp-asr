/**
 * Markdown → 朗读文本。Gemini 3.8 TTS 把输入当逐字稿，且会把 `<...>` 当语气标签，
 * 所以这里只保留“人会念出来的字”，并保证输出里没有尖括号。
 */

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[^\S\r\n]*(?:\r?\n|$)/;
const FENCED_CODE = /^[^\S\n]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[^\S\n]*\1[^\n]*$|(?![\s\S]))/gm;
const MATH_BLOCK = /^[^\S\n]*\$\$[\s\S]*?\$\$[^\n]*$/gm;
const OBSIDIAN_COMMENT = /%%[\s\S]*?%%/g;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const TABLE_SEPARATOR = /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?$/;
const FOOTNOTE_DEFINITION = /^\[\^[^\]]+\]:/;
const URL = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/g;

function cleanInline(line: string): string {
  return line
    .replace(/!\[\[[^\]]*\]\]/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]#^]*)(?:[#^][^\]]*)?\]\]/g, "$1")
    .replace(/<\/?[A-Za-z][^<>\n]*>/g, "")
    .replace(URL, "")
    .replace(/\[\^[^\]]+\]/g, "")
    .replace(/(\*\*|__|==|~~)(.+?)\1/g, "$2")
    .replace(/\*(\S(?:.*?\S)?)\*/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\$([^$\n]+)\$/g, "$1")
    .replace(/(^|\s)#[^\s#]+/g, "$1")
    .replace(/\s\^[\w-]+$/, "")
    .replace(/[<>]/g, " ")
    .replace(/[ \t ]{2,}/g, " ")
    .trim();
}

export function markdownToSpeechText(markdown: string): string {
  const body = markdown
    .replace(/\r\n?/g, "\n")
    .replace(FRONTMATTER, "")
    .replace(OBSIDIAN_COMMENT, "")
    .replace(HTML_COMMENT, "")
    .replace(FENCED_CODE, "")
    .replace(MATH_BLOCK, "");

  const lines: string[] = [];
  for (const raw of body.split("\n")) {
    let line = raw.replace(/^(?:\s*>)+\s?/, "");
    if (TABLE_SEPARATOR.test(line.trim()) || FOOTNOTE_DEFINITION.test(line.trim())) {
      continue;
    }
    line = line
      .replace(/^\s*\[![\w-]+\][+-]?\s*/, "")
      .replace(/^\s*#{1,6}\s+/, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
      .replace(/^\s*\[[ xX/-]\]\s+/, "");
    const trimmed = line.trim();
    if (/^\|.*\|$/.test(trimmed)) {
      line = trimmed
        .slice(1, -1)
        .split("|")
        .map((cell) => cleanInline(cell))
        .filter((cell) => cell.length > 0)
        .join("，");
    }
    lines.push(cleanInline(line));
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * 从某一行开始截取原文，用于“从光标处朗读”。光标落在 frontmatter、代码块或
 * 公式块内部时，从块结束后开始，否则闭合标记会被误当成新块的开头。
 */
export function markdownFromLine(markdown: string, line: number): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let start = Math.max(0, line);
  let i = 0;
  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((text, index) => index > 0 && text.trim() === "---");
    if (close > 0) {
      if (start <= close) start = close + 1;
      i = close + 1;
    }
  }
  while (i < lines.length && i <= start) {
    const opener = lines[i].trim();
    const fence = /^(`{3,}|~{3,})/.exec(opener)?.[1];
    const isMath = opener.startsWith("$$") && !(opener.length > 2 && opener.endsWith("$$"));
    if (!fence && !isMath) {
      i++;
      continue;
    }
    let close = i + 1;
    while (
      close < lines.length
      && !(fence ? lines[close].trim().startsWith(fence) : lines[close].trim().endsWith("$$"))
    ) {
      close++;
    }
    if (start > i && start <= close) start = close + 1;
    i = close + 1;
  }
  return lines.slice(start).join("\n");
}

const SENTENCE_END ="。！？!?；;…\n";
const CLOSERS = "。！？!?；;…”’」』）)\"'";

function splitSentences(paragraph: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < paragraph.length; i++) {
    const ch = paragraph[i];
    const next = paragraph[i + 1];
    const isEnd = SENTENCE_END.includes(ch)
      || (ch === "." && (next === undefined || /\s/.test(next)));
    if (isEnd && !(next !== undefined && CLOSERS.includes(next))) {
      sentences.push(paragraph.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < paragraph.length) sentences.push(paragraph.slice(start));
  return sentences.filter((sentence) => sentence.trim().length > 0);
}

function hardSplit(sentence: string, limit: number): string[] {
  const parts: string[] = [];
  let rest = sentence;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const soft = Math.max(
      window.lastIndexOf("，"),
      window.lastIndexOf(","),
      window.lastIndexOf("、"),
      window.lastIndexOf(" "),
    );
    const cut = soft >= limit / 2 ? soft + 1 : limit;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) parts.push(rest);
  return parts;
}

export interface SpeechChunkOptions {
  /** 第一段更短，缩短按下朗读到出声的等待。 */
  firstMaxChars: number;
  maxChars: number;
}

export function splitSpeechChunks(text: string, options: SpeechChunkOptions): string[] {
  const chunks: string[] = [];
  const limit = () => (chunks.length === 0 ? options.firstMaxChars : options.maxChars);
  for (const paragraph of text.split(/\n\s*\n/)) {
    let current = "";
    const flush = () => {
      if (current.trim()) chunks.push(current.trim());
      current = "";
    };
    for (const sentence of splitSentences(paragraph)) {
      const pieces = sentence.length > limit() ? hardSplit(sentence, limit()) : [sentence];
      for (const piece of pieces) {
        if (current && current.length + piece.length > limit()) flush();
        current += piece;
      }
    }
    flush();
  }
  return chunks;
}
