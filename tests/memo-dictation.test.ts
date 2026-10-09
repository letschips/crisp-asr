// @vitest-environment jsdom
// Failure modes for Pulse hold-to-dictate:
// - text must stream to the memo composer and never be written into the active note;
// - the ASR panel must not open and steal focus from the composer;
// - a running note dictation, a missing key or license must refuse cleanly before any connection;
// - releasing before the connection is up cancels quietly; a mid-session error keeps the text so far.
import { beforeEach, describe, expect, it, vi } from "vitest";

const clients: Array<{ options: { onPayload: (p: unknown) => void; onError: (e: Error) => void }; connected: boolean; finished: boolean; gate?: Promise<void> }> = [];
let connectGate: Promise<void> | null = null;

vi.mock("../src/streaming-client", () => ({
  DoubaoStreamingClient: class {
    options: never; connected = false; finished = false;
    constructor(options: never) { this.options = options; clients.push(this as never); }
    async connect() { if (connectGate) await connectGate; this.connected = true; }
    sendAudio() {}
    async finish() { this.finished = true; }
    close() {}
  },
}));
vi.mock("../src/audio-capture", () => ({
  LivePcmCapture: class {
    async acquire() {}
    async start() { return {}; }
    stopPcm() {}
    async stop() {}
  },
}));

import CrispAsrPlugin from "../src/main";

const say = (text: string, definite = true, start = 0) => ({ result: { text, utterances: [{ text, definite, start_time: start, end_time: start + 1 }] } });

function makePlugin() {
  const writes: string[] = [];
  const activeNote = { path: "Notes/active.md", basename: "active", extension: "md" };
  const app = {
    workspace: {
      containerEl: document.body, on: () => ({}), onLayoutReady: () => undefined, trigger: () => undefined,
      getActiveFile: () => activeNote, getActiveViewOfType: () => ({ file: activeNote, editor: { replaceRange: () => writes.push("editor") } }),
      getLeavesOfType: () => [],
    },
    vault: {
      on: () => ({}), adapter: { exists: async () => false, read: async () => "", write: async () => undefined },
      process: async () => { writes.push("process"); return ""; }, modify: async () => { writes.push("modify"); },
      append: async () => { writes.push("append"); }, create: async () => { writes.push("create"); },
      getAbstractFileByPath: () => null,
    },
    metadataCache: { getFileCache: () => null },
    secretStorage: { getSecret: () => "key" },
  };
  const plugin = new CrispAsrPlugin(app as never, { id: "crisp-asr" } as never);
  Object.assign(plugin.settings, { apiKeySecretName: "asr", licenseCode: "x", saveLiveAudio: true, sttEngine: "doubao", silenceAction: "off" });
  plugin.ensureLicenseActivated = async () => true;
  const internal = plugin as unknown as { openView: () => Promise<void>; writeLiveTranscript: () => Promise<never>; persistSettings: () => Promise<boolean>; liveStarting: boolean; liveSession: unknown };
  let opened = 0;
  internal.openView = async () => { opened++; };
  internal.writeLiveTranscript = async () => { writes.push("writeLiveTranscript"); throw new Error("must not write a note"); };
  internal.persistSettings = async () => true;
  return { plugin, internal, writes, opened: () => opened };
}

function sink() {
  const states: string[] = []; const texts: string[] = []; const done: Array<{ text: string; error?: string }> = [];
  return { states, texts, done, onState: (s: string) => states.push(s), onText: (t: string, p: string) => texts.push(`${t}|${p}`), onDone: (r: { text: string; error?: string }) => done.push(r) };
}

beforeEach(() => { clients.length = 0; connectGate = null; });

describe("Pulse memo dictation", () => {
  it("streams text to the memo sink and hands the final text over without touching the active note or opening the panel", async () => {
    const { plugin, internal, writes, opened } = makePlugin();
    const s = sink();
    await plugin.startMemoDictation(s);
    expect(s.states).toEqual(["connecting", "listening"]);
    clients[0].options.onPayload(say("今天下午", false));
    clients[0].options.onPayload(say("今天下午三点开会", true));
    expect(s.texts[s.texts.length - 2]).toBe("|今天下午");
    expect(s.texts[s.texts.length - 1]).toBe("今天下午三点开会|");
    await plugin.stopMemoDictation();
    expect(s.states[s.states.length - 1]).toBe("finishing");
    expect(s.done).toEqual([{ text: "今天下午三点开会" }]);
    expect(clients[0].finished).toBe(true);
    expect(writes).toEqual([]);
    expect(opened()).toBe(0);
    expect(internal.liveSession).toBeNull();
    expect(plugin.settings.liveDraft).toBeNull();
  });

  it("refuses while a note dictation is starting or running, and without a key", async () => {
    const busy = makePlugin();
    busy.internal.liveStarting = true;
    await expect(busy.plugin.startMemoDictation(sink())).rejects.toThrow(/实时听写/);
    const noKey = makePlugin();
    (noKey.plugin.app as unknown as { secretStorage: { getSecret: () => null } }).secretStorage.getSecret = () => null;
    await expect(noKey.plugin.startMemoDictation(sink())).rejects.toThrow(/API Key/);
    expect(clients).toHaveLength(0);
  });

  it("releasing before the connection is up cancels quietly", async () => {
    const { plugin, internal, writes } = makePlugin();
    let open!: () => void;
    connectGate = new Promise((r) => { open = r; });
    const s = sink();
    const starting = plugin.startMemoDictation(s);
    await new Promise((r) => setTimeout(r, 0));
    await plugin.stopMemoDictation();
    open();
    await starting.catch(() => undefined);
    expect(s.done).toEqual([{ text: "" }]);
    expect(internal.liveSession).toBeNull();
    expect(internal.liveStarting).toBe(false);
    expect(writes).toEqual([]);
  });

  it("a connection error mid-session keeps the text recognised so far", async () => {
    const { plugin, writes } = makePlugin();
    const s = sink();
    await plugin.startMemoDictation(s);
    clients[0].options.onPayload(say("先记下这一句", true));
    clients[0].options.onError(new Error("连接已断开"));
    await new Promise((r) => setTimeout(r, 0));
    await plugin.stopMemoDictation();
    expect(s.done).toHaveLength(1);
    expect(s.done[0].text).toBe("先记下这一句");
    expect(s.done[0].error).toMatch(/连接已断开/);
    expect(writes).toEqual([]);
  });
});
