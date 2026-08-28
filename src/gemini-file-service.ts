import { requestUrl } from "obsidian";
import {
  buildGeminiInteractionBody,
  parseGeminiTranscribeResponse,
  type GeminiFile,
  type GeminiTranscribeOptions,
} from "./gemini-protocol";
import type { FlashResponse } from "./flash-client";
import {
  AsrServiceError,
  isRetryableHttpStatus,
  toAsrServiceError,
} from "./service-error";

const BASE_URL = "https://generativelanguage.googleapis.com";

function authHeaders(apiKey: string): Record<string, string> {
  return { "x-goog-api-key": apiKey.trim() };
}

function normalizedHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
}

export async function uploadGeminiFile(
  apiKey: string,
  audio: ArrayBuffer,
  mimeType = "audio/wav",
  displayName = "crisp-asr-audio",
): Promise<GeminiFile> {
  const startUrl = `${BASE_URL}/upload/v1beta/files`;
  let initResponse;
  try {
    initResponse = await requestUrl({
      url: startUrl,
      method: "POST",
      headers: {
        ...authHeaders(apiKey),
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(audio.byteLength),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        file: {
          display_name: displayName,
        },
      }),
      throw: false,
    });
  } catch (error) {
    throw toAsrServiceError(error, true);
  }

  if (initResponse.status < 200 || initResponse.status >= 300) {
    const errorBody = initResponse.json as { error?: { message?: string } } | null;
    const message = errorBody?.error?.message || `HTTP ${initResponse.status}`;
    throw new AsrServiceError(`Gemini 上传音频失败: ${message}`, isRetryableHttpStatus(initResponse.status), {
      code: String(initResponse.status),
    });
  }

  const headers = normalizedHeaders(initResponse.headers);
  const uploadUrl = headers["x-goog-upload-url"];

  if (!uploadUrl) {
    // If upload returned the file metadata directly in initial response
    const json = initResponse.json as { file?: GeminiFile } | null;
    if (json?.file?.uri) {
      return json.file;
    }
    throw new AsrServiceError("Gemini 未返回有效的上传 URL", false, {
      code: "NO_UPLOAD_URL",
    });
  }

  let uploadResponse;
  try {
    uploadResponse = await requestUrl({
      url: uploadUrl,
      method: "POST",
      headers: {
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
      body: audio,
      throw: false,
    });
  } catch (error) {
    throw toAsrServiceError(error, true);
  }

  if (uploadResponse.status < 200 || uploadResponse.status >= 300) {
    const errorBody = uploadResponse.json as { error?: { message?: string } } | null;
    const message = errorBody?.error?.message || `HTTP ${uploadResponse.status}`;
    throw new AsrServiceError(`Gemini 上传音频内容失败: ${message}`, isRetryableHttpStatus(uploadResponse.status), {
      code: String(uploadResponse.status),
    });
  }

  const result = uploadResponse.json as { file?: GeminiFile };
  if (!result?.file?.uri) {
    throw new AsrServiceError("Gemini 上传音频后未返回文件 URI", false, {
      code: "INVALID_FILE_RESPONSE",
    });
  }

  return result.file;
}

export async function deleteGeminiFile(
  apiKey: string,
  fileName: string,
): Promise<void> {
  if (!fileName) return;
  const name = fileName.startsWith("files/") ? fileName : `files/${fileName}`;
  const url = `${BASE_URL}/v1beta/${name}`;
  try {
    await requestUrl({
      url,
      method: "DELETE",
      headers: authHeaders(apiKey),
      throw: false,
    });
  } catch {
    // Ignore cleanup failure
  }
}

export async function transcribeGeminiFile(
  apiKey: string,
  audio: ArrayBuffer,
  mimeType = "audio/wav",
  options?: GeminiTranscribeOptions,
): Promise<FlashResponse> {
  const file = await uploadGeminiFile(apiKey, audio, mimeType);
  try {
    const url = `${BASE_URL}/v1beta/interactions`;
    const body = buildGeminiInteractionBody(file.uri, mimeType, options);

    let response;
    try {
      response = await requestUrl({
        url,
        method: "POST",
        headers: authHeaders(apiKey),
        contentType: "application/json",
        body: JSON.stringify(body),
        throw: false,
      });
    } catch (error) {
      throw toAsrServiceError(error, true);
    }

    return parseGeminiTranscribeResponse(response.json, response.status);
  } finally {
    if (file.name) {
      await deleteGeminiFile(apiKey, file.name);
    }
  }
}

export async function runGeminiConnectionProbe(apiKey: string): Promise<void> {
  if (!apiKey || apiKey.trim().length === 0) {
    throw new AsrServiceError("Gemini API Key 不能为空", false, { code: "EMPTY_KEY" });
  }

  const url = `${BASE_URL}/v1beta/models/gemini-3.5-transcribe`;
  let response;
  try {
    response = await requestUrl({
      url,
      method: "GET",
      headers: authHeaders(apiKey),
      throw: false,
    });
  } catch (error) {
    throw toAsrServiceError(error, true);
  }

  if (response.status < 200 || response.status >= 300) {
    const errorBody = response.json as { error?: { message?: string } } | null;
    const message = errorBody?.error?.message || `HTTP ${response.status}`;
    throw new AsrServiceError(`Gemini 探测连接失败: ${message}`, isRetryableHttpStatus(response.status), {
      code: String(response.status),
    });
  }
}
