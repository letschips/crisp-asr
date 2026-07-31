import { isAudioPath } from "./audio";

export interface EditorLineReader {
  lineCount(): number;
  getLine(line: number): string;
}

export type CrispAsrProtocolAction = "open" | "start" | "stop" | "toggle";

export function resolveProtocolAction(
  params: Record<string, string>,
): CrispAsrProtocolAction | null {
  const mode = (params.mode ?? "toggle").trim().toLowerCase();
  if (mode === "live") {
    return "start";
  }
  return mode === "open"
      || mode === "start"
      || mode === "stop"
      || mode === "toggle"
    ? mode
    : null;
}

function audioLinkFromLine(line: string): string | null {
  const candidates: string[] = [];
  for (const match of line.matchAll(/!?\[\[([^\]]+)\]\]/g)) {
    candidates.push(
      (match[1] ?? "").split("|", 1)[0].split("#", 1)[0].trim(),
    );
  }
  for (const match of line.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)) {
    candidates.push((match[1] ?? "").trim().replace(/^<|>$/g, ""));
  }
  return candidates.find((path) => isAudioPath(path)) ?? null;
}

export function findAudioLinkNearCursor(
  editor: EditorLineReader,
  cursorLine: number,
): string | null {
  if (cursorLine < 0 || cursorLine >= editor.lineCount()) {
    return null;
  }
  for (const offset of [0, -1, 1, -2, 2]) {
    const line = cursorLine + offset;
    if (line >= 0 && line < editor.lineCount()) {
      const path = audioLinkFromLine(editor.getLine(line));
      if (path) {
        return path;
      }
    }
  }
  return null;
}

export function isObsidianRecordingPath(path: string): boolean {
  const parts = path.split("/");
  const fileName = parts[parts.length - 1] ?? "";
  return /^Recording \d{14}\.[^.]+$/i.test(fileName) && isAudioPath(path);
}

export function buildSidecarPath(
  outputFolder: string,
  audioPath: string,
): string {
  const parts = audioPath.split("/");
  const fileName = parts[parts.length - 1] ?? "录音";
  const dot = fileName.lastIndexOf(".");
  const stem = (dot >= 0 ? fileName.slice(0, dot) : fileName)
    .replace(/[\\/*?"<>|]/g, "")
    .trim()
    || "录音";
  const folder = outputFolder.replace(/^\/+|\/+$/g, "");
  return `${folder}/${stem}-转写.md`;
}
