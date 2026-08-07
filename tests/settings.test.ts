import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
} from "../src/settings";

describe("settings normalization", () => {
  it("uses safe first-run defaults without storing a secret value", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.apiKeySecretName).toBe("");
    expect(DEFAULT_SETTINGS.aiApiKeySecretName).toBe("");
    expect(DEFAULT_SETTINGS.aiProvider).toBe("ark");
    expect(DEFAULT_SETTINGS.aiModel).toBe("");
    expect(DEFAULT_SETTINGS.aiBaseUrl).toBe("");
    expect(DEFAULT_SETTINGS.aiOutputMode).toBe("same-note");
    expect(DEFAULT_SETTINGS.customPrompt).toBe("");
    expect(DEFAULT_SETTINGS.autoTranscribeRecordings).toBe(false);
    expect(DEFAULT_SETTINGS.microphoneDeviceId).toBe("default");
    expect(DEFAULT_SETTINGS.saveLiveAudio).toBe(false);
    expect(DEFAULT_SETTINGS.liveAudioFolder).toBe("Crisp ASR/Audio");
    expect(DEFAULT_SETTINGS.fileJobs).toEqual([]);
  });

  it("drops malformed persisted settings and bounds processed audio history", () => {
    const history = Array.from({ length: 620 }, (_, index) => `a-${index}.m4a`);
    const settings = normalizeSettings({
      apiKeySecretName: "doubao",
      outputFolder: " /Crisp ASR// ",
      outputMode: "current-note",
      liveResourceId: "",
      autoTranscribeRecordings: true,
      processedAudioPaths: [...history, "", 42],
    });
    expect(settings.apiKeySecretName).toBe("doubao");
    expect(settings.outputFolder).toBe("Crisp ASR");
    expect(settings.outputMode).toBe("current-note");
    expect(settings.liveResourceId).toBe(
      "volc.seedasr.sauc.duration",
    );
    expect(settings.processedAudioPaths).toHaveLength(500);
    expect(
      settings.processedAudioPaths[settings.processedAudioPaths.length - 1],
    ).toBe("a-619.m4a");
  });

  it("normalizes live input and recording settings", () => {
    const settings = normalizeSettings({
      liveInputMode: "computer-and-microphone",
      microphoneDeviceId: "  bluetooth-mic ",
      saveLiveAudio: true,
      liveAudioFolder: " /Crisp ASR//Audio/ ",
    });

    expect("liveInputMode" in settings).toBe(false);
    expect(settings.microphoneDeviceId).toBe("bluetooth-mic");
    expect(settings.saveLiveAudio).toBe(true);
    expect(settings.liveAudioFolder).toBe("Crisp ASR/Audio");
  });

  it("drops malformed persisted file jobs without changing valid entries", () => {
    const settings = normalizeSettings({
      fileJobs: [
        {
          id: "job-1",
          sourcePath: "Audio/interview.m4a",
          targetPath: "Notes/interview.md",
          status: "retry-wait",
          attempt: 2,
          createdAt: 10,
          updatedAt: 20,
          nextAttemptAt: 30,
          lastError: "timeout",
        },
        {
          id: "",
          sourcePath: "Audio/broken.m4a",
          status: "queued",
        },
        null,
      ],
    });

    expect(settings.fileJobs).toEqual([
      {
        id: "job-1",
        sourcePath: "Audio/interview.m4a",
        targetPath: "Notes/interview.md",
        status: "retry-wait",
        attempt: 2,
        createdAt: 10,
        updatedAt: 20,
        nextAttemptAt: 30,
        lastError: "timeout",
      },
    ]);
  });

  it("falls back from unknown input values and blank device ids", () => {
    const settings = normalizeSettings({
      liveInputMode: "camera",
      microphoneDeviceId: " ",
      liveAudioFolder: "/",
    });

    expect("liveInputMode" in settings).toBe(false);
    expect(settings.microphoneDeviceId).toBe("default");
    expect(settings.liveAudioFolder).toBe("Crisp ASR/Audio");
  });

  it("normalizes AI provider settings without persisting a credential value", () => {
    const settings = normalizeSettings({
      aiProvider: "anthropic",
      aiApiKeySecretName: "  claude-key ",
      aiModel: "  claude-example-model ",
      aiBaseUrl: " https://gateway.example.com/v1/ ",
      aiOutputMode: "new-note",
      customPrompt: "  按 {{title}} 整理 {{transcript}}  ",
      aiApiKey: "must-not-survive",
    });

    expect(settings.aiProvider).toBe("anthropic");
    expect(settings.aiApiKeySecretName).toBe("claude-key");
    expect(settings.aiModel).toBe("claude-example-model");
    expect(settings.aiBaseUrl).toBe("https://gateway.example.com/v1");
    expect(settings.aiOutputMode).toBe("new-note");
    expect(settings.customPrompt).toBe("按 {{title}} 整理 {{transcript}}");
    expect(settings).not.toHaveProperty("aiApiKey");
  });

  it("falls back from unsupported AI providers and output modes", () => {
    const settings = normalizeSettings({
      aiProvider: "unknown-provider",
      aiOutputMode: "replace-original",
      aiModel: 42,
      aiBaseUrl: 42,
    });

    expect(settings.aiProvider).toBe("ark");
    expect(settings.aiOutputMode).toBe("same-note");
    expect(settings.aiModel).toBe("");
    expect(settings.aiBaseUrl).toBe("");
  });
});
