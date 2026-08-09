// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import CrispAsrPlugin from "../src/main";
import { findUntranscribedAudio } from "../src/main";
import { matchesAutoTranscribeScope } from "../src/file-routing";

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
    vault: {
      on: () => ({}),
    },
    secretStorage: {
      getSecret: () => null,
    },
  };
}

describe("plugin interaction registration", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("registers the rewritten commands and URL protocol on top of the ALL plugin", async () => {
    const plugin = new CrispAsrPlugin(
      createApp() as never,
      { id: "crisp-asr" } as never,
    );

    await plugin.onload();

    const commands = (
      plugin as unknown as { __commands: Array<{ id: string }> }
    ).__commands.map((command) => command.id);
    expect(commands).toContain("test-connection");
    expect(commands).toContain("test-ai-connection");
    expect(commands).toContain("transcribe-audio-near-cursor");
    expect(commands).toContain("scan-untranscribed-recordings");
    expect(commands).toContain("polish-current-transcript");
    expect(commands).toContain("extract-current-transcript");
    expect(commands).toContain("custom-process-current-transcript");
    expect(
      (
        plugin as unknown as {
          __protocolHandlers: Map<string, unknown>;
        }
      ).__protocolHandlers.has("crisp-asr"),
    ).toBe(true);
  });

  it("moves a legacy plaintext API key into SecretStorage on first load", async () => {
    const secrets = new Map<string, string>();
    const app = createApp();
    app.secretStorage = {
      getSecret: (id: string) => secrets.get(id) ?? null,
      setSecret: (id: string, value: string) => {
        secrets.set(id, value);
      },
      listSecrets: () => [...secrets.keys()],
    };
    const plugin = new CrispAsrPlugin(
      app as never,
      { id: "crisp-asr" } as never,
    );
    let saved: unknown;
    plugin.loadData = async () => ({
      appId: "legacy-app",
      accessToken: "legacy-api-key",
      resourceId: "volc.bigasr.sauc.duration",
    });
    plugin.saveData = async (value: unknown) => {
      saved = value;
    };

    await plugin.onload();

    expect(plugin.settings.apiKeySecretName).toBe("crisp-asr-api-key");
    expect(plugin.settings.liveResourceId).toBe("volc.bigasr.sauc.duration");
    expect(secrets.get("crisp-asr-api-key")).toBe("legacy-api-key");
    expect(saved).toMatchObject({
      apiKeySecretName: "crisp-asr-api-key",
    });
    expect(saved).not.toHaveProperty("accessToken");
    expect(saved).not.toHaveProperty("appId");
  });

  it("refreshes connected microphones after a device change", async () => {
    let devices = [
      {
        kind: "audioinput",
        deviceId: "built-in",
        label: "MacBook Pro 麦克风",
      },
    ];
    const listeners = new Set<() => void>();
    const mediaDevices = {
      enumerateDevices: async () => devices,
      addEventListener: (type: string, listener: () => void) => {
        if (type === "devicechange") {
          listeners.add(listener);
        }
      },
      removeEventListener: (type: string, listener: () => void) => {
        if (type === "devicechange") {
          listeners.delete(listener);
        }
      },
    };
    const originalMediaDevices = window.navigator.mediaDevices;
    Object.defineProperty(window.navigator, "mediaDevices", {
      configurable: true,
      value: mediaDevices,
    });
    const plugin = new CrispAsrPlugin(
      createApp() as never,
      { id: "crisp-asr" } as never,
    );

    try {
      await plugin.onload();
      devices = [
        ...devices,
        {
          kind: "audioinput",
          deviceId: "wireless-rx",
          label: "Wireless Mic Rx",
        },
      ];
      for (const listener of listeners) {
        listener();
      }
      await plugin.refreshMicrophones();

      expect(plugin.uiState.microphones).toContainEqual({
        deviceId: "wireless-rx",
        label: "Wireless Mic Rx",
      });

      await plugin.onunload();
      expect(listeners.size).toBe(0);
    } finally {
      Object.defineProperty(window.navigator, "mediaDevices", {
        configurable: true,
        value: originalMediaDevices,
      });
    }
  });

  it("lets the stop control cancel a live session that is still connecting", async () => {
    const plugin = new CrispAsrPlugin(
      createApp() as never,
      { id: "crisp-asr" } as never,
    );
    const abort = new AbortController();
    const internal = plugin as unknown as {
      liveStarting: boolean;
      liveStartAbort: AbortController | null;
    };
    internal.liveStarting = true;
    internal.liveStartAbort = abort;
    plugin.uiState.mode = "connecting";
    plugin.uiState.status = "连接中";

    await plugin.stopLiveTranscription();

    expect(abort.signal.aborted).toBe(true);
    expect(plugin.uiState.mode).toBe("idle");
    expect(plugin.uiState.status).toBe("就绪");
  });
});

describe("auto-transcribe scope matching", () => {
  it("matches only Obsidian recorder naming by default", () => {
    expect(matchesAutoTranscribeScope(
      "Recording 20260807120000.m4a",
      "recording",
      "",
    )).toBe(true);
    expect(matchesAutoTranscribeScope(
      "语音备忘录.m4a",
      "recording",
      "",
    )).toBe(false);
    expect(matchesAutoTranscribeScope(
      "notes/Recording 20260807120000.webm",
      "recording",
      "",
    )).toBe(true);
  });

  it("matches any audio file in the chosen folder", () => {
    expect(matchesAutoTranscribeScope(
      "录音/语音备忘录.m4a",
      "folder",
      "/录音/",
    )).toBe(true);
    expect(matchesAutoTranscribeScope(
      "其他/语音备忘录.m4a",
      "folder",
      "录音",
    )).toBe(false);
    expect(matchesAutoTranscribeScope(
      "其他/Recording 20260807120000.m4a",
      "folder",
      "录音",
    )).toBe(false);
  });

  it("matches any audio file when scope is any, but not non-audio files", () => {
    expect(matchesAutoTranscribeScope("任意目录/语音备忘录.m4a", "any", ""))
      .toBe(true);
    expect(matchesAutoTranscribeScope("任意目录/笔记.md", "any", ""))
      .toBe(false);
  });
});

describe("untranscribed audio discovery", () => {
  const files = [
    { path: "录音/a.m4a" },
    { path: "录音/b.mp3" },
    { path: "录音/c.md" },
    { path: "剪辑/d.webm" },
    { path: "e.txt" },
  ];

  it("finds audio not yet processed or queued, sorted by path", () => {
    expect(findUntranscribedAudio(
      files,
      ["录音/a.m4a"],
      ["剪辑/d.webm"],
    )).toEqual(["录音/b.mp3"]);
  });

  it("keeps failed jobs eligible for a rescan", () => {
    expect(findUntranscribedAudio(
      files,
      [],
      [],
    )).toEqual(["剪辑/d.webm", "录音/a.m4a", "录音/b.mp3"]);
  });
});
