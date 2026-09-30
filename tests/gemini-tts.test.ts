import { describe, expect, it } from "vitest";
import { buildGeminiTtsBody, parseGeminiTtsResponse } from "../src/gemini-tts";
import { AsrServiceError } from "../src/service-error";

describe("Gemini TTS protocol", () => {
  it("builds the Interactions body verified by the 2026-09-30 smoke test", () => {
    expect(buildGeminiTtsBody("你好", { model: "gemini-3.8-flash-lite-tts", voice: "Kore", style: "" }))
      .toEqual({
        model: "gemini-3.8-flash-lite-tts",
        input: [{ type: "user_input", content: [{ type: "text", text: "你好" }] }],
        response_format: { type: "audio" },
        generation_config: { speech_config: [{ voice: "Kore" }] },
      });
  });

  it("adds speech_metadata only when a style is set", () => {
    const body = buildGeminiTtsBody("你好", { model: "gemini-3.8-flash-tts", voice: "Puck", style: " 温和 " });
    expect(body.input[0].content[0]).toEqual({
      type: "text",
      text: "你好",
      annotations: [{ type: "speech_metadata", style: "温和" }],
    });
  });

  it("decodes the last audio block from steps[].content[]", () => {
    const wav = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2]);
    const b64 = Buffer.from(wav).toString("base64");
    const result = parseGeminiTtsResponse({
      status: "completed",
      steps: [{ type: "model_output", content: [
        { type: "audio", mime_type: "audio/wav", data: Buffer.from("old").toString("base64") },
        { type: "audio", mime_type: "audio/wav", data: b64 },
      ] }],
    }, 200);
    expect(result.mimeType).toBe("audio/wav");
    expect(Array.from(new Uint8Array(result.audio))).toEqual(Array.from(wav));
  });

  it("throws a retryable service error on 429/5xx and a plain one on 400", () => {
    const rate = () => parseGeminiTtsResponse({ error: { code: 429, message: "quota" } }, 429);
    expect(rate).toThrow(AsrServiceError);
    try { rate(); } catch (e) { expect((e as AsrServiceError).retryable).toBe(true); }
    try {
      parseGeminiTtsResponse({ error: { code: 400, message: "bad voice" } }, 400);
      expect.unreachable();
    } catch (e) {
      expect((e as AsrServiceError).retryable).toBe(false);
      expect((e as Error).message).toContain("bad voice");
    }
  });

  it("throws when a 200 response carries no audio", () => {
    expect(() => parseGeminiTtsResponse({ status: "completed", steps: [] }, 200)).toThrow(/没有返回音频/);
  });
});
