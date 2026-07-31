import { describe, expect, it } from "vitest";
import {
  buildSidecarPath,
  findAudioLinkNearCursor,
  isObsidianRecordingPath,
  resolveProtocolAction,
} from "../src/file-routing";

describe("recording discovery", () => {
  it("recognizes Obsidian recording names without depending on one extension", () => {
    expect(isObsidianRecordingPath(
      "90-附件与模板/图片/Recording 20260529111911.m4a",
    )).toBe(true);
    expect(isObsidianRecordingPath("audio/Recording 20260729101010.webm"))
      .toBe(true);
    expect(isObsidianRecordingPath("audio/lecture.m4a")).toBe(false);
  });
});

describe("sidecar path", () => {
  it("sanitizes the title and places the note in the configured folder", () => {
    expect(buildSidecarPath("Crisp ASR", "课件/第一讲：概率?.m4a"))
      .toBe("Crisp ASR/第一讲：概率-转写.md");
  });
});

describe("audio link near the cursor", () => {
  it("prefers the current line and resolves wikilink aliases", () => {
    const lines = [
      "![[attachments/older.mp3]]",
      "课堂录音：![[attachments/lecture.m4a|第一讲]]",
      "[讲义](notes/lecture.md)",
    ];

    expect(findAudioLinkNearCursor({
      lineCount: () => lines.length,
      getLine: (line) => lines[line] ?? "",
    }, 1)).toBe("attachments/lecture.m4a");
  });

  it("searches adjacent lines and accepts Markdown audio links", () => {
    const lines = [
      "[课堂录音](attachments/lecture.webm)",
      "光标在这里",
      "[课件](notes/lecture.md)",
    ];

    expect(findAudioLinkNearCursor({
      lineCount: () => lines.length,
      getLine: (line) => lines[line] ?? "",
    }, 1)).toBe("attachments/lecture.webm");
  });
});

describe("Obsidian URL routing", () => {
  it("normalizes supported shortcut modes and defaults to toggle", () => {
    expect(resolveProtocolAction({ action: "crisp-asr", mode: "live" }))
      .toBe("start");
    expect(resolveProtocolAction({ action: "crisp-asr", mode: "stop" }))
      .toBe("stop");
    expect(resolveProtocolAction({ action: "crisp-asr" })).toBe("toggle");
  });
});
