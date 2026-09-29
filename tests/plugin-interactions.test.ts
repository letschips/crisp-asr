// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import { TFile } from "obsidian";
import CrispAsrPlugin from "../src/main";
import { findUntranscribedAudio } from "../src/main";
import { collectTranscribedAudioPaths } from "../src/main";
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
      await Promise.resolve();
      await Promise.resolve();

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

describe("settings and auto-transcription safety", () => {
  it("backs up an unreadable data.json before defaults can overwrite it", async () => {
    const copies: Array<[string, string]> = [];
    const app = createApp();
    (app.vault as Record<string, unknown>).adapter = {
      exists: async (path: string) => path === ".obsidian/plugins/crisp-asr/data.json",
      copy: async (from: string, to: string) => {
        copies.push([from, to]);
      },
    };
    const plugin = new CrispAsrPlugin(
      app as never,
      { id: "crisp-asr", dir: ".obsidian/plugins/crisp-asr" } as never,
    );
    plugin.loadData = async () => undefined;

    await plugin.onload();

    expect(copies).toHaveLength(1);
    expect(copies[0]?.[0]).toBe(".obsidian/plugins/crisp-asr/data.json");
    expect(copies[0]?.[1]).toMatch(/^\.obsidian\/plugins\/crisp-asr\/data\.json\.unreadable-\d+$/);
  });

  it("does not back up anything on a genuine first install", async () => {
    let copied = false;
    const app = createApp();
    (app.vault as Record<string, unknown>).adapter = {
      exists: async () => false,
      copy: async () => {
        copied = true;
      },
    };
    const plugin = new CrispAsrPlugin(
      app as never,
      { id: "crisp-asr", dir: ".obsidian/plugins/crisp-asr" } as never,
    );
    plugin.loadData = async () => null;

    await plugin.onload();

    expect(copied).toBe(false);
  });

  it("detects a settings write that did not reach disk", async () => {
    const files = new Map<string, string>();
    const app = createApp();
    (app.vault as Record<string, unknown>).adapter = {
      exists: async (path: string) => files.has(path),
      read: async (path: string) => {
        const value = files.get(path);
        if (value === undefined) throw new Error("ENOENT");
        return value;
      },
      copy: async () => undefined,
    };
    const plugin = new CrispAsrPlugin(
      app as never,
      { id: "crisp-asr", dir: "plugins/crisp-asr" } as never,
    );
    plugin.loadData = async () => null;
    await plugin.onload();
    const internal = plugin as unknown as {
      persistSettings: (options?: { quiet?: boolean }) => Promise<boolean>;
    };

    // Obsidian's saveData resolves even when nothing was written.
    plugin.saveData = async () => undefined;
    await expect(internal.persistSettings({ quiet: true })).resolves.toBe(false);

    // A truncated write is caught by the read-back.
    plugin.saveData = async (value: unknown) => {
      files.set("plugins/crisp-asr/data.json", JSON.stringify(value).slice(0, 20));
    };
    await expect(internal.persistSettings({ quiet: true })).resolves.toBe(false);

    plugin.saveData = async (value: unknown) => {
      files.set("plugins/crisp-asr/data.json", JSON.stringify(value, null, 2));
    };
    await expect(internal.persistSettings({ quiet: true })).resolves.toBe(true);
  });

  it("leaves the starting state when setup fails before connecting", async () => {
    const app = createApp();
    app.secretStorage = { getSecret: () => "key" };
    const plugin = new CrispAsrPlugin(app as never, { id: "crisp-asr" } as never);
    Object.assign(plugin.settings, {
      apiKeySecretName: "asr",
      licenseCode: "x",
      saveLiveAudio: false,
    });
    const internal = plugin as unknown as {
      liveStarting: boolean;
      buildRecognition: () => Promise<never>;
    };
    plugin.ensureLicenseActivated = async () => true;
    internal.buildRecognition = async () => {
      throw new Error("setup exploded");
    };

    await plugin.startLiveTranscription();

    expect(internal.liveStarting).toBe(false);
    expect(plugin.uiState.mode).toBe("error");
    expect(plugin.uiState.status).toBe("启动失败");
  });

  it("does not auto-transcribe the recording it is saving for a live session", () => {
    const plugin = new CrispAsrPlugin(
      createApp() as never,
      { id: "crisp-asr" } as never,
    );
    Object.assign(plugin.settings, {
      autoTranscribeRecordings: true,
      autoTranscribeScope: "folder",
      autoTranscribeFolder: "Audio",
      saveLiveAudio: true,
      liveAudioFolder: "Audio",
    });
    const internal = plugin as unknown as {
      liveSession: unknown;
      autoTimers: Set<number>;
      handleCreatedFile: (file: unknown) => void;
    };
    const file = Object.assign(new TFile(), {
      path: "Audio/live-20260929-120000.webm",
      name: "live-20260929-120000.webm",
      extension: "webm",
    });

    internal.liveSession = {};
    internal.handleCreatedFile(file);
    expect(internal.autoTimers.size).toBe(0);

    internal.liveSession = null;
    internal.handleCreatedFile(file);
    expect(internal.autoTimers.size).toBe(1);
    for (const timer of internal.autoTimers) window.clearTimeout(timer);
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

  it("excludes audio already referenced by a completed transcript note", () => {
    const notes = [
      { path: "Crisp ASR/a.md" },
      { path: "Crisp ASR/b.md" },
    ];
    const metadata = {
      getFileCache: (file: { path: string }) => file.path.endsWith("a.md")
        ? { frontmatter: { source_audio: "[[录音/a.m4a]]" } }
        : { frontmatter: { source_audio: "not-an-audio.txt" } },
    };

    const completed = collectTranscribedAudioPaths(metadata, notes);
    expect([...completed]).toEqual(["录音/a.m4a"]);
    expect(findUntranscribedAudio(files, [...completed], []))
      .toEqual(["剪辑/d.webm", "录音/b.mp3"]);
  });
});
