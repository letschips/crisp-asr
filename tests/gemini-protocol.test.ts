import { describe, expect, it } from "vitest";
import {
  buildGeminiInteractionBody,
  parseGeminiTranscribeResponse,
} from "../src/gemini-protocol";

describe("Gemini protocol", () => {
  it("builds smart mode interaction body with diarization and timestamps disabled", () => {
    const body = buildGeminiInteractionBody(
      "https://generativelanguage.googleapis.com/v1beta/files/test-123",
      "audio/wav",
      {
        mode: "smart",
        identifySpeakers: true, // Should be ignored in smart mode
        wordTimestamps: true, // Should be ignored in smart mode
        customVocabulary: ["Obsidian", "Crisp ASR"],
      },
    );

    expect(body).toEqual({
      model: "gemini-3.5-transcribe",
      input: [
        {
          type: "audio",
          uri: "https://generativelanguage.googleapis.com/v1beta/files/test-123",
          mime_type: "audio/wav",
        },
      ],
      generation_config: {
        transcription_config: {
          mode: "smart",
          custom_vocabulary: ["Obsidian", "Crisp ASR"],
        },
      },
    });
  });

  it("builds verbatim mode interaction body with diarization and timestamps enabled", () => {
    const body = buildGeminiInteractionBody(
      "https://generativelanguage.googleapis.com/v1beta/files/test-456",
      "audio/mp3",
      {
        mode: "verbatim",
        identifySpeakers: true,
        wordTimestamps: true,
        languageCode: "zh-CN",
      },
    );

    expect(body).toEqual({
      model: "gemini-3.5-transcribe",
      input: [
        {
          type: "audio",
          uri: "https://generativelanguage.googleapis.com/v1beta/files/test-456",
          mime_type: "audio/mp3",
        },
      ],
      generation_config: {
        transcription_config: {
          language_codes: ["zh-CN"],
          mode: {
            type: "verbatim",
            diarization_mode: "speaker",
            timestamp_granularities: ["word"],
          },
        },
      },
    });
  });

  it("limits custom vocabulary to 1,000 phrases", () => {
    const longList = Array.from({ length: 1_200 }, (_, i) => `term-${i}`);
    const body = buildGeminiInteractionBody("uri", "audio/wav", {
      customVocabulary: longList,
    });
    const params = (body.generation_config as {
      transcription_config: { custom_vocabulary: string[] };
    }).transcription_config;
    expect(params.custom_vocabulary.length).toBe(1_000);
  });

  it("parses official word_info annotations into real timed utterances", () => {
    const response = parseGeminiTranscribeResponse({
      id: "interactions/abc123xyz",
      output_text: "你好 Gemini",
      steps: [{
        content: [{
          type: "text",
          text: "你好 Gemini",
          annotations: [
            {
              type: "word_info",
              text: "你好",
              speaker: "spk_1",
              start_offset: "0.100s",
              end_offset: "0.450s",
            },
            {
              type: "word_info",
              text: "Gemini",
              speaker: "spk_1",
              start_offset: "0.500s",
              end_offset: "0.850s",
            },
          ],
        }],
      }],
    });

    expect(response.logId).toBe("interactions/abc123xyz");
    expect(response.utterances).toEqual([
      {
        text: "你好",
        start_time: 100,
        end_time: 450,
        definite: true,
        speaker: "spk_1",
      },
      {
        text: "Gemini",
        start_time: 500,
        end_time: 850,
        definite: true,
        speaker: "spk_1",
      },
    ]);
  });

  it("rejects a non-success HTTP response even without a JSON error object", () => {
    expect(() => parseGeminiTranscribeResponse({}, 503))
      .toThrowError("Gemini 转写失败: HTTP 503");
  });

  it("rejects a completed response that contains no transcript", () => {
    expect(() => parseGeminiTranscribeResponse({
      id: "interactions/empty",
      status: "completed",
      steps: [],
    }))
      .toThrowError("Gemini 转写失败: 服务返回了空结果");
  });

  it("parses output_text with speaker annotations", () => {
    const json = {
      id: "interaction-123",
      output_text: "Speaker 1: 第一句话。\nSpeaker 2: 第二句话。",
    };
    const response = parseGeminiTranscribeResponse(json, 200);
    expect(response.logId).toBe("interaction-123");
    expect(response.utterances.length).toBe(2);
    expect(response.utterances[0]).toEqual({
      text: "第一句话。",
      start_time: 0,
      end_time: 1_000,
      definite: true,
      speaker: "1",
    });
    expect(response.utterances[1]).toEqual({
      text: "第二句话。",
      start_time: 1_000,
      end_time: 2_000,
      definite: true,
      speaker: "2",
    });
  });

  it("parses structured segments when returned by Gemini", () => {
    const json = {
      segments: [
        { text: "你好", start_time_ms: 0, end_time_ms: 500, speaker: "Alice" },
        { text: "很高兴见到你", startTime: "0.5s", endTime: "1.2s", speaker_id: "Bob" },
      ],
    };
    const response = parseGeminiTranscribeResponse(json, 200);
    expect(response.utterances).toEqual([
      { text: "你好", start_time: 0, end_time: 500, definite: true, speaker: "Alice" },
      { text: "很高兴见到你", start_time: 500, end_time: 1_200, definite: true, speaker: "Bob" },
    ]);
  });

  it("throws AsrServiceError on error payload", () => {
    expect(() =>
      parseGeminiTranscribeResponse(
        {
          error: {
            code: 429,
            message: "Quota exceeded",
            status: "RESOURCE_EXHAUSTED",
          },
        },
        429,
      )
    ).toThrowError("Gemini 转写失败: Quota exceeded");
  });
});
