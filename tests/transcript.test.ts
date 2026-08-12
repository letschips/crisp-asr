import { describe, expect, it } from "vitest";
import {
  extractTranscriptResult,
  renderLiveTranscriptBlock,
  TranscriptAccumulator,
  formatTimestamp,
  renderTranscriptNote,
  extractSpeakerNumbers,
  renameSpeakerLabels,
} from "../src/transcript";

describe("TranscriptAccumulator", () => {
  it("extracts transcript fields from a full server payload", () => {
    expect(extractTranscriptResult({
      audio_info: { duration: 1200 },
      result: {
        text: "一段。",
        utterances: [
          {
            text: "一段。",
            start_time: 0,
            end_time: 1_200,
            definite: true,
          },
        ],
      },
    })).toEqual({
      text: "一段。",
      utterances: [
        {
          text: "一段。",
          start_time: 0,
          end_time: 1_200,
          definite: true,
        },
      ],
    });
  });

  it("extracts speaker metadata and keeps stable rename markers", () => {
    const result = extractTranscriptResult({ result: { text: "你好", utterances: [{
      text: "你好", definite: true, additions: '{"speaker_id":"A"}',
    }] } });
    expect(result.utterances?.[0]?.speaker).toBe("A");
    const note = renderTranscriptNote({
      title: "访谈", sourcePath: "访谈.m4a", createdAt: "2026-08-12T00:00:00Z",
      text: "你好", utterances: result.utterances ?? [],
    });
    expect(extractSpeakerNumbers(note)).toEqual([1]);
    expect(renameSpeakerLabels(note, { 1: "主持人" })).toContain("**主持人：** 你好");
  });

  it("emits a finalized utterance only once while preserving interim text", () => {
    const accumulator = new TranscriptAccumulator();
    expect(accumulator.consume({
      text: "老师今天讲",
      utterances: [
        {
          text: "老师今天讲",
          start_time: 0,
          end_time: 900,
          definite: false,
        },
      ],
    })).toEqual({
      added: [],
      preview: "老师今天讲",
    });

    const finalized = accumulator.consume({
      text: "老师今天讲概率。",
      utterances: [
        {
          text: "老师今天讲概率。",
          start_time: 0,
          end_time: 1_200,
          definite: true,
        },
      ],
    });
    expect(finalized.added).toHaveLength(1);
    expect(finalized.preview).toBe("");

    expect(accumulator.consume({
      text: "老师今天讲概率。",
      utterances: [
        {
          text: "老师今天讲概率。",
          start_time: 0,
          end_time: 1_200,
          definite: true,
        },
      ],
    }).added).toEqual([]);
    expect(accumulator.finalText()).toBe("老师今天讲概率。");
  });
});

describe("transcript output", () => {
  it("formats timestamps without wrapping after one hour", () => {
    expect(formatTimestamp(3_723_000)).toBe("01:02:03");
  });

  it("renders a Tolaria-compatible sidecar note with audio provenance", () => {
    const note = renderTranscriptNote({
      title: "Lecture 转写",
      sourcePath: "attachments/Lecture.m4a",
      createdAt: "2026-07-29T10:00:00.000Z",
      text: "第一段。\n第二段。",
      utterances: [
        { text: "第一段。", start_time: 0, end_time: 900, definite: true },
        { text: "第二段。", start_time: 1_000, end_time: 2_000, definite: true },
      ],
      logId: "log-123",
    });
    expect(note).toContain("type: Note");
    expect(note).toContain('source_audio: "[[attachments/Lecture.m4a]]"');
    expect(note).toContain("# Lecture 转写");
    expect(note).toContain("![[attachments/Lecture.m4a]]");
    expect(note).toContain("`00:00` 第一段。");
    expect(note).toContain("log_id: log-123");
  });

  it("renders a compact live transcript block for the active note", () => {
    expect(renderLiveTranscriptBlock({
      startedAt: "2026-07-29T10:00:00.000Z",
      text: "第一句。\n第二句。",
      utterances: [],
    })).toBe(
      "\n\n## 实时转写 · 2026-07-29 10:00\n\n第一句。\n第二句。\n",
    );
  });

  it("embeds the optional saved live recording before transcript text", () => {
    expect(renderLiveTranscriptBlock({
      startedAt: "2026-07-29T10:00:00.000Z",
      text: "会议结论。",
      utterances: [],
      audioPath: "Crisp ASR/Audio/live-20260729-180000.webm",
    })).toBe(
      "\n\n## 实时转写 · 2026-07-29 10:00\n\n"
      + "![[Crisp ASR/Audio/live-20260729-180000.webm]]\n\n"
      + "会议结论。\n",
    );
  });
});
