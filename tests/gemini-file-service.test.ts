import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestUrlMock } = vi.hoisted(() => ({ requestUrlMock: vi.fn() }));
vi.mock("obsidian", () => ({ requestUrl: requestUrlMock }));

import {
  uploadGeminiFile,
  deleteGeminiFile,
  transcribeGeminiFile,
  runGeminiConnectionProbe,
} from "../src/gemini-file-service";

describe("Gemini file service", () => {
  beforeEach(() => {
    requestUrlMock.mockReset();
  });

  it("completes 2-step resumable upload to Gemini Files API", async () => {
    const audioData = new Uint8Array([1, 2, 3, 4]).buffer;

    // Step 1 response: start resumable session
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      headers: {
        "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/session/abc",
      },
      json: {},
    });

    // Step 2 response: upload file bytes
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      headers: {},
      json: {
        file: {
          name: "files/abc123xyz",
          uri: "https://generativelanguage.googleapis.com/v1beta/files/abc123xyz",
          mimeType: "audio/wav",
        },
      },
    });

    const file = await uploadGeminiFile("test-key", audioData, "audio/wav", "sample.wav");
    expect(file.uri).toBe("https://generativelanguage.googleapis.com/v1beta/files/abc123xyz");
    expect(requestUrlMock).toHaveBeenCalledTimes(2);

    const uploadRequest = requestUrlMock.mock.calls[1]?.[0];
    expect(uploadRequest).toMatchObject({
      method: "POST",
      body: audioData,
      headers: {
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
    });
    // Obsidian's Chromium-backed requestUrl rejects manually controlled
    // Content-Length with net::ERR_INVALID_ARGUMENT. It derives the length
    // from the ArrayBuffer body itself.
    expect(uploadRequest.headers).not.toHaveProperty("Content-Length");
  });

  it("calls DELETE to clean up file after upload", async () => {
    requestUrlMock.mockResolvedValueOnce({ status: 200, json: {} });
    await deleteGeminiFile("test-key", "files/abc123xyz");
    expect(requestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        url: "https://generativelanguage.googleapis.com/v1beta/files/abc123xyz",
        headers: { "x-goog-api-key": "test-key" },
      }),
    );
  });

  it("transcribes file and automatically cleans up uploaded file", async () => {
    const audioData = new Uint8Array([1, 2, 3]).buffer;

    // 1. Upload init
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      headers: { "x-goog-upload-url": "https://upload-session" },
      json: {},
    });
    // 2. Upload finalize
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      headers: {},
      json: {
        file: {
          name: "files/sample-id",
          uri: "https://files/sample-id",
          mimeType: "audio/wav",
        },
      },
    });
    // 3. Interactions API
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      headers: {},
      json: {
        output_text: "转写文本测试。",
      },
    });
    // 4. Delete file (cleanup in finally)
    requestUrlMock.mockResolvedValueOnce({ status: 200, json: {} });

    const result = await transcribeGeminiFile("my-key", audioData, "audio/wav", {
      mode: "smart",
    });

    expect(result.text).toBe("转写文本测试。");
    expect(requestUrlMock).toHaveBeenCalledTimes(4);
  });

  it("probes connection using models list endpoint", async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      json: { models: [{ name: "models/gemini-3.5-transcribe" }] },
    });
    await expect(runGeminiConnectionProbe("valid-key")).resolves.toBeUndefined();
  });

  it("keeps the API key out of HTTP URLs and sends it in a request header", async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      json: { name: "models/gemini-3.5-transcribe" },
    });

    await runGeminiConnectionProbe("private-key");

    expect(requestUrlMock).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-transcribe",
      headers: { "x-goog-api-key": "private-key" },
    }));
  });

  it("throws error when probe key is empty or API returns 403", async () => {
    await expect(runGeminiConnectionProbe("")).rejects.toThrowError("Gemini API Key 不能为空");

    requestUrlMock.mockResolvedValueOnce({
      status: 403,
      json: { error: { message: "API_KEY_INVALID" } },
    });
    await expect(runGeminiConnectionProbe("bad-key")).rejects.toThrowError("Gemini 探测连接失败");
  });
});
