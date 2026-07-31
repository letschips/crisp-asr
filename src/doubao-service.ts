import { randomUUID } from "node:crypto";
import { requestUrl } from "obsidian";
import {
  buildFlashRequest,
  parseFlashResponse,
  type FlashResponse,
} from "./flash-client";
import { toAsrServiceError } from "./service-error";

const FLASH_URL =
  "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash";
const FLASH_RESOURCE_ID = "volc.bigasr.auc_turbo";

export async function transcribeFlash(
  apiKey: string,
  audio: ArrayBuffer,
): Promise<FlashResponse> {
  const base64 = Buffer.from(audio).toString("base64");
  let response;
  try {
    response = await requestUrl({
      url: FLASH_URL,
      method: "POST",
      contentType: "application/json",
      headers: {
        "X-Api-Key": apiKey,
        "X-Api-Resource-Id": FLASH_RESOURCE_ID,
        "X-Api-Request-Id": randomUUID(),
        "X-Api-Sequence": "-1",
      },
      body: JSON.stringify(buildFlashRequest(base64, "crisp-asr-desktop")),
      throw: false,
    });
  } catch (error) {
    throw toAsrServiceError(error, true);
  }
  return parseFlashResponse(response);
}
