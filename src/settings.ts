import {
  normalizeLiveDraft,
  type PersistedLiveDraft,
} from "./live-draft";

export type AiProvider =
  | "ark"
  | "openai"
  | "anthropic"
  | "deepseek"
  | "custom";

export type AiOutputMode = "same-note" | "new-note";

export type AutoTranscribeScope = "recording" | "folder" | "any";
export type SilenceAction = "warn" | "stop" | "off";
export type SilenceDurationSeconds = 30 | 60 | 120;

export type FileJobStatus =
  | "queued"
  | "preparing"
  | "transcribing"
  | "retry-wait"
  | "completed"
  | "failed";

export interface PersistedFileJob {
  id: string;
  sourcePath: string;
  targetPath?: string;
  status: FileJobStatus;
  attempt: number;
  createdAt: number;
  updatedAt: number;
  nextAttemptAt?: number;
  lastError?: string;
  outputPath?: string;
}

export interface CrispAsrSettings {
  apiKeySecretName: string;
  aiProvider: AiProvider;
  aiApiKeySecretName: string;
  aiModel: string;
  aiBaseUrl: string;
  aiOutputMode: AiOutputMode;
  customPrompt: string;
  autoTranscribeRecordings: boolean;
  autoTranscribeScope: AutoTranscribeScope;
  autoTranscribeFolder: string;
  outputFolder: string;
  outputMode: "sidecar" | "current-note";
  liveResourceId: string;
  processedAudioPaths: string[];
  microphoneDeviceId: string;
  saveLiveAudio: boolean;
  liveAudioFolder: string;
  silenceAction: SilenceAction;
  silenceDurationSeconds: SilenceDurationSeconds;
  liveDraft: PersistedLiveDraft | null;
  fileJobs: PersistedFileJob[];
  licenseCode: string;
}

export const DEFAULT_SETTINGS: CrispAsrSettings = {
  apiKeySecretName: "",
  aiProvider: "ark",
  aiApiKeySecretName: "",
  aiModel: "",
  aiBaseUrl: "",
  aiOutputMode: "same-note",
  customPrompt: "",
  autoTranscribeRecordings: false,
  autoTranscribeScope: "recording",
  autoTranscribeFolder: "",
  outputFolder: "Crisp ASR",
  outputMode: "sidecar",
  liveResourceId: "volc.seedasr.sauc.duration",
  processedAudioPaths: [],
    microphoneDeviceId: "default",
  saveLiveAudio: false,
  liveAudioFolder: "Crisp ASR/Audio",
  silenceAction: "warn",
  silenceDurationSeconds: 60,
  liveDraft: null,
  fileJobs: [],
  licenseCode: "",
};

const FILE_JOB_STATUSES = new Set<FileJobStatus>([
  "queued",
  "preparing",
  "transcribing",
  "retry-wait",
  "completed",
  "failed",
]);

function cleanFolder(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
  return normalized || fallback;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanUrl(value: unknown): string {
  return cleanText(value).replace(/\/+$/g, "");
}

function optionalString(
  candidate: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = candidate[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function optionalNumber(
  candidate: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = candidate[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function normalizeFileJobs(value: unknown): PersistedFileJob[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): PersistedFileJob[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const candidate = entry as Record<string, unknown>;
    const id = optionalString(candidate, "id");
    const sourcePath = optionalString(candidate, "sourcePath");
    const status = candidate.status;
    const attempt = optionalNumber(candidate, "attempt");
    const createdAt = optionalNumber(candidate, "createdAt");
    const updatedAt = optionalNumber(candidate, "updatedAt");
    if (
      !id
      || !sourcePath
      || typeof status !== "string"
      || !FILE_JOB_STATUSES.has(status as FileJobStatus)
      || attempt === undefined
      || attempt < 0
      || createdAt === undefined
      || updatedAt === undefined
    ) {
      return [];
    }
    const targetPath = optionalString(candidate, "targetPath");
    const nextAttemptAt = optionalNumber(candidate, "nextAttemptAt");
    const lastError = optionalString(candidate, "lastError");
    const outputPath = optionalString(candidate, "outputPath");
    return [{
      id,
      sourcePath,
      ...(targetPath ? { targetPath } : {}),
      status: status as FileJobStatus,
      attempt: Math.floor(attempt),
      createdAt,
      updatedAt,
      ...(nextAttemptAt !== undefined ? { nextAttemptAt } : {}),
      ...(lastError ? { lastError } : {}),
      ...(outputPath ? { outputPath } : {}),
    }];
  });
}

export function normalizeSettings(value: unknown): CrispAsrSettings {
  const candidate = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const history = Array.isArray(candidate.processedAudioPaths)
    ? candidate.processedAudioPaths
      .filter((path): path is string =>
        typeof path === "string" && path.trim().length > 0
      )
      .map((path) => path.trim())
      .slice(-5_000)
    : [];
  return {
    apiKeySecretName: typeof candidate.apiKeySecretName === "string"
      ? candidate.apiKeySecretName
      : DEFAULT_SETTINGS.apiKeySecretName,
    aiProvider:
      candidate.aiProvider === "openai"
      || candidate.aiProvider === "anthropic"
      || candidate.aiProvider === "deepseek"
      || candidate.aiProvider === "custom"
        ? candidate.aiProvider
        : "ark",
    aiApiKeySecretName: cleanText(candidate.aiApiKeySecretName),
    aiModel: cleanText(candidate.aiModel),
    aiBaseUrl: cleanUrl(candidate.aiBaseUrl),
    aiOutputMode: candidate.aiOutputMode === "new-note"
      ? "new-note"
      : "same-note",
    customPrompt: cleanText(candidate.customPrompt),
    autoTranscribeRecordings: candidate.autoTranscribeRecordings === true,
    autoTranscribeScope: candidate.autoTranscribeScope === "folder"
      || candidate.autoTranscribeScope === "any"
      ? candidate.autoTranscribeScope
      : "recording",
    autoTranscribeFolder:
      typeof candidate.autoTranscribeFolder === "string"
        ? candidate.autoTranscribeFolder
          .trim()
          .replace(/^\/+|\/+$/g, "")
        : DEFAULT_SETTINGS.autoTranscribeFolder,
    outputFolder: cleanFolder(
      candidate.outputFolder,
      DEFAULT_SETTINGS.outputFolder,
    ),
    outputMode: candidate.outputMode === "current-note"
      ? "current-note"
      : "sidecar",
    liveResourceId:
      typeof candidate.liveResourceId === "string"
      && candidate.liveResourceId.trim().length > 0
        ? candidate.liveResourceId.trim()
        : DEFAULT_SETTINGS.liveResourceId,
    processedAudioPaths: history,
    microphoneDeviceId:
      typeof candidate.microphoneDeviceId === "string"
      && candidate.microphoneDeviceId.trim().length > 0
        ? candidate.microphoneDeviceId.trim()
        : DEFAULT_SETTINGS.microphoneDeviceId,
    saveLiveAudio: candidate.saveLiveAudio === true,
    liveAudioFolder: cleanFolder(
      candidate.liveAudioFolder,
      DEFAULT_SETTINGS.liveAudioFolder,
    ),
    silenceAction: candidate.silenceAction === "stop"
      || candidate.silenceAction === "off"
      ? candidate.silenceAction
      : "warn",
    silenceDurationSeconds: candidate.silenceDurationSeconds === 30
      || candidate.silenceDurationSeconds === 120
      ? candidate.silenceDurationSeconds
      : 60,
    liveDraft: normalizeLiveDraft(candidate.liveDraft),
    fileJobs: normalizeFileJobs(candidate.fileJobs),
    licenseCode: cleanText(candidate.licenseCode),
  };
}
