// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import CrispAsrPlugin from "../src/main";

// Hardening: the license gate is a module function, so replacing a method on the plugin
// instance from the console (the old one-line unlock) must not start a licensed feature.
function createApp(): Record<string, unknown> {
  return {
    workspace: {
      containerEl: document.body,
      on: () => ({}),
      onLayoutReady: () => undefined,
      getActiveFile: () => null,
      getActiveViewOfType: () => null,
      getLeavesOfType: () => [],
    },
    vault: { on: () => ({}) },
    secretStorage: { getSecret: () => "key" },
  };
}

describe("license gate", () => {
  it("overriding a plugin method does not unlock live transcription", async () => {
    const plugin = new CrispAsrPlugin(createApp() as never, { id: "crisp-asr" } as never);
    Object.assign(plugin.settings, { apiKeySecretName: "asr", licenseCode: "", saveLiveAudio: false });
    let started = false;
    const internal = plugin as unknown as Record<string, unknown>;
    internal.ensureLicenseActivated = async () => true;
    internal.buildRecognition = async () => {
      started = true;
      throw new Error("stop here");
    };
    await plugin.startLiveTranscription();
    expect(started).toBe(false);
  });
});
