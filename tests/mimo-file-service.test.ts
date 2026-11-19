import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestUrlMock } = vi.hoisted(() => ({ requestUrlMock: vi.fn() }));
vi.mock("obsidian", () => ({ requestUrl: requestUrlMock }));

import { pcm16PacketsToWav } from "../src/audio";
import {
  looksTruncated,
  planMimoSegments,
  readPcm16Wav,
  transcribeMimoFile,
} from "../src/mimo-file-service";

const RATE = 16_000;

/** Loud noise everywhere except the given silent ranges (in seconds). */
function speech(seconds: number, silences: Array<[number, number]> = []): Int16Array {
  const samples = new Int16Array(seconds * RATE);
  for (let index = 0; index < samples.length; index += 1) {
    const t = index / RATE;
    const silent = silences.some(([from, to]) => t >= from && t < to);
    samples[index] = silent ? 0 : (index % 2 ? 8_000 : -8_000);
  }
  return samples;
}

function wavOf(samples: Int16Array): ArrayBuffer {
  return pcm16PacketsToWav([new Uint8Array(samples.buffer)], RATE);
}

function ok(content: string) {
  return { status: 200, json: { choices: [{ message: { content } }] }, text: "" };
}

const zh = (count: number) => "字".repeat(count);

describe("MiMo segment planning", () => {
  it("keeps short audio in one request", () => {
    expect(planMimoSegments(speech(30))).toEqual([{ start: 0, end: 30 * RATE }]);
  });

  it("cuts long audio at pauses into contiguous 45–90 s pieces", () => {
    const samples = speech(200, [[70, 71], [150, 151]]);
    const segments = planMimoSegments(samples);
    expect(segments).toHaveLength(3);
    expect(segments[0].start).toBe(0);
    expect(segments[segments.length - 1].end).toBe(samples.length);
    for (let index = 1; index < segments.length; index += 1) {
      expect(segments[index].start).toBe(segments[index - 1].end);
    }
    for (const segment of segments) {
      expect((segment.end - segment.start) / RATE).toBeLessThanOrEqual(90);
    }
    expect(segments[0].end / RATE).toBeGreaterThanOrEqual(70);
    expect(segments[0].end / RATE).toBeLessThan(71);
  });

  it("reads PCM back out of the WAV it was given", () => {
    const samples = speech(1);
    expect(readPcm16Wav(wavOf(samples))).toEqual(samples);
  });
});

describe("truncation check", () => {
  it("flags a 165 s answer of 170 chars but not a complete one", () => {
    expect(looksTruncated(zh(170), 165)).toBe(true);
    expect(looksTruncated(zh(600), 165)).toBe(false);
    expect(looksTruncated("", 10)).toBe(false);
  });
});

describe("transcribeMimoFile", () => {
  beforeEach(() => requestUrlMock.mockReset());

  it("sends each segment as a wav data URL and keeps segment order", async () => {
    requestUrlMock
      .mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return ok(zh(250));
      })
      .mockResolvedValueOnce(ok(zh(300)))
      .mockResolvedValueOnce(ok(zh(200)));
    const result = await transcribeMimoFile("sk-test", wavOf(speech(200, [[70, 71], [150, 151]])));
    expect(requestUrlMock).toHaveBeenCalledTimes(3);
    const request = requestUrlMock.mock.calls[0][0];
    expect(request.url).toBe("https://api.xiaomimimo.com/v1/chat/completions");
    expect(request.headers.Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(request.body);
    expect(body.model).toBe("mimo-v2.5-asr");
    expect(body.asr_options).toEqual({ language: "auto" });
    expect(body.messages[0].content[0].input_audio.data).toMatch(/^data:audio\/wav;base64,UklGR/);
    expect(result.utterances.map((u) => u.text.length)).toEqual([250, 300, 200]);
    expect(result.utterances[0].start_time).toBe(0);
    expect(result.utterances[1].start_time).toBe(result.utterances[0].end_time);
  });

  it("retries a segment that silently dropped speech as two halves", async () => {
    requestUrlMock
      .mockResolvedValueOnce(ok(zh(40)))
      .mockResolvedValueOnce(ok(zh(100)))
      .mockResolvedValueOnce(ok(zh(110)));
    const result = await transcribeMimoFile("sk-test", wavOf(speech(60, [[30, 31]])));
    expect(requestUrlMock).toHaveBeenCalledTimes(3);
    expect(result.text).toBe(zh(210));
  });

  it("keeps the first answer when the retry is not longer", async () => {
    requestUrlMock
      .mockResolvedValueOnce(ok(zh(40)))
      .mockResolvedValueOnce(ok(zh(10)))
      .mockResolvedValueOnce(ok(""));
    const result = await transcribeMimoFile("sk-test", wavOf(speech(60)));
    expect(result.text).toBe(zh(40));
  });

  it("reports an invalid key without retrying the job", async () => {
    requestUrlMock.mockResolvedValue({ status: 401, json: { error: { message: "Invalid API Key" } }, text: "" });
    await expect(transcribeMimoFile("bad", wavOf(speech(5)))).rejects.toMatchObject({
      retryable: false,
      message: expect.stringContaining("MiMo API Key 无效"),
    });
  });

  it("marks rate limits as retryable", async () => {
    requestUrlMock.mockResolvedValue({ status: 429, json: { error: { message: "busy" } }, text: "" });
    await expect(transcribeMimoFile("sk-test", wavOf(speech(5)))).rejects.toMatchObject({ retryable: true });
  });

  it("treats an all-empty answer as an empty result", async () => {
    requestUrlMock.mockResolvedValue(ok(""));
    await expect(transcribeMimoFile("sk-test", wavOf(speech(5)))).rejects.toThrow("服务返回了空结果");
  });
});
