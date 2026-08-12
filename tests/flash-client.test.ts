import { describe, expect, it } from "vitest";
import {
  buildFlashRequest,
  parseFlashResponse,
  runConnectionProbe,
} from "../src/flash-client";

describe("Doubao flash transcription", () => {
  it("builds a Base64 audio request with punctuation and utterances enabled", () => {
    expect(buildFlashRequest("AQID", "crisp-asr")).toEqual({
      user: { uid: "crisp-asr" },
      audio: { data: "AQID" },
      request: {
        model_name: "bigmodel",
        enable_itn: true,
        enable_punc: true,
        enable_ddc: true,
        show_utterances: true,
      },
    });
  });

  it("normalizes successful response headers and transcript fields", () => {
    expect(parseFlashResponse({
      status: 200,
      headers: {
        "X-Api-Status-Code": "20000000",
        "X-Tt-Logid": "log-123",
      },
      json: {
        result: {
          text: "测试。",
          utterances: [
            { text: "测试。", start_time: 0, end_time: 500 },
          ],
        },
      },
    })).toEqual({
      text: "测试。",
      utterances: [
        { text: "测试。", start_time: 0, end_time: 500, definite: true },
      ],
      logId: "log-123",
    });
  });

  it("preserves speaker metadata returned by file transcription", () => {
    const result = parseFlashResponse({
      status: 200,
      headers: { "x-api-status-code": "20000000" },
      json: { result: { text: "你好", utterances: [{
        text: "你好", additions: { speaker_id: "guest" },
      }] } },
    });
    expect(result.utterances[0]?.speaker).toBe("guest");
  });

  it("surfaces the service code and log ID when recognition fails", () => {
    try {
      parseFlashResponse({
        status: 200,
        headers: {
          "x-api-status-code": "45000151",
          "x-api-message": "audio format error",
          "x-tt-logid": "log-bad",
        },
        json: {},
      });
      throw new Error("expected parseFlashResponse to throw");
    } catch (error) {
      expect(error).toMatchObject({
        message: "45000151 · audio format error · Log ID: log-bad",
        retryable: false,
      });
    }
  });

  it.each([408, 429, 500, 503])(
    "marks HTTP %s as retryable",
    (status) => {
      try {
        parseFlashResponse({
          status,
          headers: {},
          json: {},
        });
        throw new Error("expected parseFlashResponse to throw");
      } catch (error) {
        expect(error).toMatchObject({ retryable: true });
      }
    },
  );

  it.each(["55000031", "55000999"])(
    "marks temporary service code %s as retryable even with HTTP 200",
    (serviceCode) => {
      try {
        parseFlashResponse({
          status: 200,
          headers: {
            "x-api-status-code": serviceCode,
            "x-api-message": "service unavailable",
          },
          json: {},
        });
        throw new Error("expected parseFlashResponse to throw");
      } catch (error) {
        expect(error).toMatchObject({
          code: serviceCode,
          retryable: true,
        });
      }
    },
  );

  it.each([400, 401, 403])(
    "marks HTTP %s as permanent",
    (status) => {
      try {
        parseFlashResponse({
          status,
          headers: {},
          json: {},
        });
        throw new Error("expected parseFlashResponse to throw");
      } catch (error) {
        expect(error).toMatchObject({ retryable: false });
      }
    },
  );

  it("turns network exceptions into typed retryable errors", async () => {
    const { toAsrServiceError } = await import("../src/service-error");
    const converted = toAsrServiceError(new TypeError("fetch failed"), true);

    expect(converted).toMatchObject({
      message: "fetch failed",
      retryable: true,
    });
  });

  it("probes the existing flash path with 100 ms of silent 16 kHz WAV", async () => {
    let receivedKey = "";
    let receivedAudio = new ArrayBuffer(0);

    await runConnectionProbe("secret-key", async (apiKey, audio) => {
      receivedKey = apiKey;
      receivedAudio = audio;
      return { text: "", utterances: [] };
    });

    const view = new DataView(receivedAudio);
    expect(receivedKey).toBe("secret-key");
    expect(new TextDecoder().decode(receivedAudio.slice(0, 4))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(40, true)).toBe(3_200);
  });

  it("treats the service no-speech response as a healthy connection", async () => {
    await expect(runConnectionProbe("secret-key", async () => {
      throw new Error("20000003 · no speech");
    })).resolves.toBeUndefined();

    await expect(runConnectionProbe("secret-key", async () => {
      throw new Error("45000151 · audio format error");
    })).rejects.toThrow("45000151");
  });
});
