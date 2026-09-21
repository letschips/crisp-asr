import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestUrlMock } = vi.hoisted(() => ({ requestUrlMock: vi.fn() }));
vi.mock("obsidian", () => ({ requestUrl: requestUrlMock }));

import { pcm16PacketsToWav } from "../src/audio";
import { DoubaoMobileRecorderClient } from "../src/doubao-mobile-client";

describe("pcm16PacketsToWav", () => {
  it("generates a valid 16kHz 16-bit mono WAV header", () => {
    const packet1 = new Uint8Array([10, 0, 20, 0]);
    const packet2 = new Uint8Array([30, 0, 40, 0]);
    const wav = pcm16PacketsToWav([packet1, packet2], 16_000);

    expect(wav.byteLength).toBe(44 + 8);
    const view = new DataView(wav);
    const text = (offset: number, len: number) =>
      Array.from({ length: len }, (_, i) => String.fromCharCode(view.getUint8(offset + i))).join("");

    expect(text(0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(36 + 8);
    expect(text(8, 4)).toBe("WAVE");
    expect(text(12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // Mono
    expect(view.getUint32(24, true)).toBe(16_000); // 16kHz
    expect(view.getUint16(34, true)).toBe(16); // 16 bits
    expect(text(36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(8);

    const payload = new Uint8Array(wav, 44);
    expect(Array.from(payload)).toEqual([10, 0, 20, 0, 30, 0, 40, 0]);
  });
});

describe("DoubaoMobileRecorderClient", () => {
  beforeEach(() => {
    requestUrlMock.mockReset();
  });

  it("fails connect if apiKey is empty", async () => {
    const client = new DoubaoMobileRecorderClient({
      apiKey: "   ",
      onPayload: () => undefined,
      onError: () => undefined,
    });
    await expect(client.connect()).rejects.toThrow("豆包 API Key 不能为空");
  });

  it("throws descriptive error if recorded audio is empty", async () => {
    const client = new DoubaoMobileRecorderClient({
      apiKey: "valid-key",
      onPayload: () => undefined,
      onError: () => undefined,
    });
    await client.connect();
    await expect(client.finish()).rejects.toThrow("未采集到音频数据");
  });

  it("throws descriptive error if recorded audio is too short", async () => {
    const client = new DoubaoMobileRecorderClient({
      apiKey: "valid-key",
      onPayload: () => undefined,
      onError: () => undefined,
    });
    await client.connect();
    // 只有 10 字节，远低于 9600 字节阈值
    client.sendAudio(new Uint8Array(10));
    await expect(client.finish()).rejects.toThrow("录音时间太短（不足 0.3 秒）");
  });

  it("captures audio packets and completes Flash transcription on finish", async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      headers: {
        "x-api-status-code": "20000000",
        "x-tt-logid": "log-12345",
      },
      json: {
        result: {
          text: "你好，这是一次移动端录音转写测试。",
          utterances: [
            {
              text: "你好，这是一次移动端录音转写测试。",
              start_time: 0,
              end_time: 2500,
              definite: true,
            },
          ],
        },
      },
    });

    const payloads: any[] = [];
    let capturedLogId = "";
    const client = new DoubaoMobileRecorderClient({
      apiKey: "test-api-key",
      onPayload: (p) => payloads.push(p),
      onError: (e) => { throw e; },
      onLogId: (id) => { capturedLogId = id; },
    });

    await client.connect();

    // 发送两包 5000 字节的 PCM 数据，达到 10000 字节（> 9600 字节阈值）
    client.sendAudio(new Uint8Array(5000));
    client.sendAudio(new Uint8Array(5000));

    await client.finish();

    expect(requestUrlMock).toHaveBeenCalledTimes(1);
    const callArgs = requestUrlMock.mock.calls[0][0];
    expect(callArgs.url).toBe("https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash");
    expect(callArgs.headers["X-Api-Key"]).toBe("test-api-key");
    expect(capturedLogId).toBe("log-12345");
    expect(payloads).toHaveLength(1);
    expect(payloads[0].result.text).toBe("你好，这是一次移动端录音转写测试。");
  });

  it("throws clear guidance when no speech is detected by provider", async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      headers: {
        "x-api-status-code": "20000003",
        "x-api-message": "no speech detected",
      },
      json: {},
    });

    const onPayload = vi.fn();
    const onError = vi.fn();
    const client = new DoubaoMobileRecorderClient({
      apiKey: "test-api-key",
      onPayload,
      onError,
    });

    await client.connect();
    client.sendAudio(new Uint8Array(16000));
    await expect(client.finish()).rejects.toThrow("未检测到清晰语音");
    expect(onPayload).not.toHaveBeenCalled();
  });
});
