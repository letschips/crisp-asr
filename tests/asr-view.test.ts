// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { CrispAsrView } from "../src/asr-view";

function plugin(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    settings: {
      microphoneDeviceId: "bluetooth",
      saveLiveAudio: true,
      aiProvider: "ark",
      dictationProfileId: "free",
    },
    uiState: {
      mode: "idle",
      status: "就绪",
      preview: "",
      finalized: [],
      targetPath: null,
      inputLevel: 0.42,
      smartTargetPath: null,
      smartMode: "idle",
      smartProgress: "",
      microphones: [
        { deviceId: "default", label: "系统默认" },
        { deviceId: "bluetooth", label: "蓝牙耳机" },
      ],
      microphoneWarning: "",
      activeMicrophoneLabel: "",
      microphoneTestMode: "idle",
      recoveryDraft: null,
      markers: [],
      jobs: [],
    },
    subscribe: () => () => undefined,
    formatElapsed: () => "00:00",
    refreshMicrophones: async () => undefined,
    setMicrophoneDevice: async () => undefined,
    setSaveLiveAudio: async () => undefined,
    toggleMicrophoneTest: async () => undefined,
    restoreLiveDraft: async () => undefined,
    discardLiveDraft: async () => undefined,
    startLiveTranscription: async () => undefined,
    stopLiveTranscription: async () => undefined,
    scanUntranscribedRecordings: async () => undefined,
    retryFileJob: async () => undefined,
    removeFileJob: async () => undefined,
    openFileJobResult: async () => undefined,
    startSmartProcessing: async () => undefined,
    startCreationWorkflow: async () => undefined,
    setDictationProfile: async () => undefined,
    addLiveMarker: async () => undefined,
    ...overrides,
  };
}

function viewFor(instance: Record<string, unknown>): CrispAsrView {
  const view = new CrispAsrView({} as never, instance as never);
  const content = view.contentEl as HTMLElement & {
    addClass: (...classes: string[]) => void;
    empty: () => void;
  };
  content.addClass = (...classes) => content.classList.add(...classes);
  content.empty = () => content.replaceChildren();
  return view;
}

describe("Crisp ASR view controls", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("shows microphone, recording and level controls", async () => {
    const view = viewFor(plugin());

    await view.onOpen();

    const microphone = view.contentEl.querySelector<HTMLSelectElement>(
      ".crisp-asr-microphone",
    );
    const save = view.contentEl.querySelector<HTMLInputElement>(
      ".crisp-asr-save-audio input",
    );
    const meter = view.contentEl.querySelector<HTMLElement>(
      ".crisp-asr-level__fill",
    );
    expect(microphone?.value).toBe("bluetooth");
    expect(save?.checked).toBe(true);
    expect(meter?.style.width).toBe("42%");
    expect(view.contentEl.querySelector<HTMLButtonElement>(
      ".crisp-asr-microphone-test",
    )?.textContent).toContain("测试麦克风");
  });

  it("shows the active microphone while testing and offers stop", async () => {
    const instance = plugin();
    Object.assign(instance.uiState as object, {
      microphoneTestMode: "testing",
      activeMicrophoneLabel: "Wireless Mic Rx",
    });
    const view = viewFor(instance);

    await view.onOpen();

    expect(view.contentEl.querySelector(".crisp-asr-microphone-test")?.textContent)
      .toContain("停止测试");
    expect(view.contentEl.querySelector(".crisp-asr-active-microphone")?.textContent)
      .toContain("Wireless Mic Rx");
  });

  it("offers a scan action in the recent jobs header", async () => {
    let scans = 0;
    const instance = plugin({
      scanUntranscribedRecordings: async () => {
        scans += 1;
      },
    });
    const view = viewFor(instance);

    await view.onOpen();

    const scan = view.contentEl.querySelector<HTMLButtonElement>(
      ".crisp-asr-jobs__scan",
    );
    expect(scan).not.toBeNull();
    scan?.click();
    expect(scans).toBe(1);
  });

  it("offers safe recovery actions for an interrupted live draft", async () => {
    const calls: string[] = [];
    const instance = plugin({
      restoreLiveDraft: async (mode: string) => calls.push(`restore:${mode}`),
      discardLiveDraft: async () => calls.push("discard"),
    });
    (instance.uiState as { recoveryDraft: unknown }).recoveryDraft = {
      id: "draft-1",
      startedAt: "2026-08-12T08:00:00.000Z",
      targetPath: "Notes/idea.md",
      utterances: [{
        text: "找回我",
        start_time: 0,
        end_time: 500,
        definite: true,
      }],
      preview: "",
      updatedAt: 123,
    };
    const view = viewFor(instance);

    await view.onOpen();
    const buttons = Array.from(
      view.contentEl.querySelectorAll<HTMLButtonElement>(
        ".crisp-asr-recovery button",
      ),
    );
    expect(buttons.map((button) => button.textContent)).toEqual([
      "写回原笔记",
      "创建恢复笔记",
      "丢弃",
    ]);
    buttons.forEach((button) => button.click());
    await Promise.resolve();
    expect(calls).toEqual(["restore:target", "restore:new-note", "discard"]);
  });

  it("updates only the level meter when the input level changes", async () => {
    let notify: () => void = () => undefined;
    const instance = plugin({
      subscribe: (listener: () => void) => {
        notify = listener;
        return () => undefined;
      },
    });
    const view = viewFor(instance);
    await view.onOpen();
    const shell = view.contentEl.querySelector(".crisp-asr-shell");

    (instance.uiState as { inputLevel: number }).inputLevel = 0.81;
    notify();

    expect(view.contentEl.querySelector(".crisp-asr-shell")).toBe(shell);
    expect(
      view.contentEl.querySelector<HTMLElement>(".crisp-asr-level__fill")
        ?.style.width,
    ).toBe("81%");
  });

  it("updates elapsed time without replacing the listening controls", async () => {
    let notify: () => void = () => undefined;
    let elapsed = "00:01";
    const instance = plugin({
      subscribe: (listener: () => void) => {
        notify = listener;
        return () => undefined;
      },
      formatElapsed: () => elapsed,
    });
    (instance.uiState as { mode: string }).mode = "listening";
    const view = viewFor(instance);
    await view.onOpen();
    const controls = view.contentEl.querySelector(".crisp-asr-controls");

    elapsed = "00:02";
    notify();

    expect(view.contentEl.querySelector(".crisp-asr-controls")).toBe(controls);
    expect(
      view.contentEl.querySelector(".crisp-asr-controls strong")?.textContent,
    ).toBe("实时听写 · 00:02");
  });

  it("preserves transcript scroll position across transcript updates", async () => {
    let notify: () => void = () => undefined;
    const instance = plugin({
      subscribe: (listener: () => void) => {
        notify = listener;
        return () => undefined;
      },
    });
    const state = instance.uiState as {
      finalized: Array<{
        text: string;
        start_time: number;
        end_time: number;
        definite: boolean;
      }>;
    };
    state.finalized = [
      { text: "第一句", start_time: 0, end_time: 500, definite: true },
    ];
    const view = viewFor(instance);
    await view.onOpen();
    const body = view.contentEl.querySelector<HTMLElement>(
      ".crisp-asr-transcript__body",
    );
    if (!body) {
      throw new Error("transcript body was not rendered");
    }
    Object.defineProperties(body, {
      scrollHeight: { configurable: true, value: 600 },
      clientHeight: { configurable: true, value: 200 },
    });
    body.scrollTop = 120;

    state.finalized = [
      ...state.finalized,
      { text: "第二句", start_time: 600, end_time: 900, definite: true },
    ];
    notify();

    expect(
      view.contentEl.querySelector<HTMLElement>(
        ".crisp-asr-transcript__body",
      )?.scrollTop,
    ).toBe(120);
  });

  it("shows the microphone label header", async () => {
    const view = viewFor(plugin());

    await view.onOpen();

    expect(view.contentEl.querySelector(
      ".crisp-asr-field__header > span:first-child",
    )?.textContent).toBe("麦克风");
  });

  it("shows a missing preferred microphone warning without removing its option", async () => {
    const instance = plugin();
    (instance.uiState as { microphoneWarning: string }).microphoneWarning =
      "已选麦克风当前不可用，开始时将使用系统默认";
    (instance.uiState as { microphones: Array<{ deviceId: string; label: string }> })
      .microphones = [
        { deviceId: "default", label: "系统默认" },
        { deviceId: "bluetooth", label: "已选麦克风（当前不可用）" },
        { deviceId: "wireless-rx", label: "Wireless Mic Rx" },
      ];
    const view = viewFor(instance);

    await view.onOpen();

    expect(view.contentEl.querySelector(".crisp-asr-device-warning")?.textContent)
      .toContain("当前不可用");
    expect(Array.from(view.contentEl.querySelectorAll("option"))
      .map((option) => option.textContent)).toContain("Wireless Mic Rx");
  });

  it("explains where a live transcript goes when no note is open", async () => {
    const instance = plugin();
    const view = viewFor(instance);
    await view.onOpen();
    expect(
      view.contentEl.querySelector(".crisp-asr-controls .crisp-asr-card__title")
        ?.textContent,
    ).toContain("可直接开始");

    (instance.uiState as { mode: string }).mode = "listening";
    let notify: () => void = () => undefined;
    const listeningInstance = plugin({
      uiState: instance.uiState,
      subscribe: (listener: () => void) => {
        notify = listener;
        return () => undefined;
      },
    });
    const listeningView = viewFor(listeningInstance);
    await listeningView.onOpen();
    notify();
    expect(
      listeningView.contentEl.querySelector(
        ".crisp-asr-controls .crisp-asr-card__title",
      )?.textContent,
    ).toContain("结束后将创建一篇转写笔记");
  });

  it("renders persistent job actions and attempt information", async () => {
    const calls: string[] = [];
    const instance = plugin({
      retryFileJob: async (id: string) => {
        calls.push(`retry:${id}`);
      },
      removeFileJob: async (id: string) => {
        calls.push(`remove:${id}`);
      },
    });
    (instance.uiState as { jobs: unknown[] }).jobs = [
      {
        id: "failed-1",
        sourcePath: "Audio/interview.m4a",
        status: "failed",
        attempt: 3,
        createdAt: 1,
        updatedAt: 2,
        lastError: "网络中断",
      },
    ];
    const view = viewFor(instance);

    await view.onOpen();
    const row = view.contentEl.querySelector(".crisp-asr-job");
    const labels = Array.from(row?.querySelectorAll("button") ?? [])
      .map((button) => button.textContent);
    expect(row?.textContent).toContain("interview.m4a");
    expect(row?.textContent).toContain("第 3 次");
    expect(row?.textContent).toContain("网络中断");
    expect(labels).toEqual(["重试", "移除"]);

    const buttons = row?.querySelectorAll("button");
    buttons?.[0]?.click();
    buttons?.[1]?.click();
    await Promise.resolve();
    expect(calls).toEqual(["retry:failed-1", "remove:failed-1"]);
  });

  it("lets the user cancel a queued job but not a running one", async () => {
    const calls: string[] = [];
    const instance = plugin({
      removeFileJob: async (id: string) => {
        calls.push(`remove:${id}`);
      },
    });
    (instance.uiState as { jobs: unknown[] }).jobs = [
      { id: "q", sourcePath: "Audio/q.m4a", status: "queued", attempt: 0, createdAt: 1, updatedAt: 3 },
      { id: "t", sourcePath: "Audio/t.m4a", status: "transcribing", attempt: 1, createdAt: 1, updatedAt: 2 },
    ];
    const view = viewFor(instance);

    await view.onOpen();
    const rows = view.contentEl.querySelectorAll(".crisp-asr-job");
    expect(Array.from(rows[0]?.querySelectorAll("button") ?? []).map((b) => b.textContent))
      .toEqual(["取消"]);
    expect(rows[1]?.querySelectorAll("button")).toHaveLength(0);
    rows[0]?.querySelector("button")?.click();
    await Promise.resolve();
    expect(calls).toEqual(["remove:q"]);
  });

  it("lets the user reach jobs beyond the five-item preview", async () => {
    const instance = plugin();
    (instance.uiState as { jobs: unknown[] }).jobs = Array.from(
      { length: 6 },
      (_, index) => ({
        id: `job-${index}`,
        sourcePath: `Audio/job-${index}.m4a`,
        status: index === 0 ? "failed" : "completed",
        attempt: 1,
        createdAt: index,
        updatedAt: index,
        ...(index === 0 ? { lastError: "旧任务失败" } : {}),
      }),
    );
    const view = viewFor(instance);

    await view.onOpen();

    expect(view.contentEl.querySelectorAll(".crisp-asr-job")).toHaveLength(5);
    const toggle = view.contentEl.querySelector<HTMLButtonElement>(
      ".crisp-asr-jobs__toggle",
    );
    expect(toggle?.textContent).toBe("查看全部");
    toggle?.click();
    expect(view.contentEl.querySelectorAll(".crisp-asr-job")).toHaveLength(6);
    expect(view.contentEl.textContent).toContain("旧任务失败");
    expect(
      view.contentEl.querySelector<HTMLButtonElement>(
        ".crisp-asr-jobs__toggle",
      )?.textContent,
    ).toBe("收起");
  });

  it("keeps the stop and marker buttons stable while recognition updates stream in", async () => {
    let notify: () => void = () => undefined;
    const stops: string[] = [];
    const instance = plugin({
      subscribe: (listener: () => void) => {
        notify = listener;
        return () => undefined;
      },
      stopLiveTranscription: async () => {
        stops.push("stop");
      },
    });
    const state = instance.uiState as {
      mode: string;
      preview: string;
      finalized: Array<{ text: string; start_time: number; end_time: number; definite: boolean }>;
    };
    state.mode = "listening";
    state.preview = "正在说";
    const view = viewFor(instance);
    await view.onOpen();
    const findStop = () => Array.from(
      view.contentEl.querySelectorAll<HTMLButtonElement>(".crisp-asr-button"),
    ).find((button) => button.textContent?.includes("结束并写入"));
    const stop = findStop();
    const marker = view.contentEl.querySelector(".crisp-asr-marker-actions button");

    state.preview = "正在说第二句";
    notify();
    state.finalized = [{ text: "第一句", start_time: 0, end_time: 1, definite: true }];
    state.preview = "";
    notify();

    expect(findStop()).toBe(stop);
    expect(view.contentEl.querySelector(".crisp-asr-marker-actions button")).toBe(marker);
    const paragraphs = Array.from(
      view.contentEl.querySelectorAll(".crisp-asr-transcript__body p"),
    ).map((node) => [node.className, node.textContent]);
    expect(paragraphs).toEqual([["crisp-asr-utterance", "第一句"]]);
    expect(view.contentEl.querySelector(".crisp-asr-transcript .crisp-asr-card__title span")?.textContent)
      .toBe("1 个确定分句");
    stop?.click();
    await Promise.resolve();
    expect(stops).toEqual(["stop"]);
  });

  it("offers cancel while a live session is still connecting", async () => {
    const instance = plugin();
    (instance.uiState as { mode: string }).mode = "connecting";
    const view = viewFor(instance);

    await view.onOpen();

    const cancel = Array.from(
      view.contentEl.querySelectorAll<HTMLButtonElement>(".crisp-asr-button"),
    ).find((button) => button.textContent?.includes("取消"));
    expect(cancel?.disabled).toBe(false);
  });

  it("prevents a second stop while the current session is finishing", async () => {
    const instance = plugin();
    (instance.uiState as { mode: string }).mode = "finishing";
    const view = viewFor(instance);

    await view.onOpen();

    const stop = Array.from(
      view.contentEl.querySelectorAll<HTMLButtonElement>(".crisp-asr-button"),
    ).find((button) => button.textContent?.includes("结束并写入"));
    expect(stop?.disabled).toBe(true);
  });

  it("offers manual polish, extraction and custom processing for a finished transcript", async () => {
    const calls: string[] = [];
    const instance = plugin({
      startCreationWorkflow: async () => { calls.push("creation"); },
      startSmartProcessing: async (mode: string) => {
        calls.push(mode);
      },
    });
    Object.assign(instance.uiState as Record<string, unknown>, {
      smartTargetPath: "Crisp ASR/interview.md",
      smartMode: "idle",
      smartProgress: "",
    });
    const view = viewFor(instance);

    await view.onOpen();

    const card = view.contentEl.querySelector(".crisp-asr-smart");
    expect(card?.textContent).toContain("interview.md");
    const buttons = Array.from(
      card?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    expect(buttons.map((button) => button.textContent)).toEqual([
      "分阶段创作",
      "润色整理",
      "重点提炼",
      "自定义",
    ]);
    for (const button of buttons) {
      button.click();
    }
    await Promise.resolve();
    expect(calls).toEqual(["creation", "polish", "extract", "custom"]);
  });

  it("disables smart processing until a transcript note is available", async () => {
    const view = viewFor(plugin());

    await view.onOpen();

    const card = view.contentEl.querySelector(".crisp-asr-smart");
    expect(card?.textContent).toContain("打开一篇转写笔记");
    expect(
      Array.from(card?.querySelectorAll<HTMLButtonElement>("button") ?? [])
        .every((button) => button.disabled),
    ).toBe(true);
  });

  it("reads the last opened note aloud from the panel, and stays disabled without one", async () => {
    const calls: string[] = [];
    const idle = viewFor(plugin({ readAloudTarget: async () => { calls.push("start"); } }));
    await idle.onOpen();
    const idleCard = idle.contentEl.querySelector(".crisp-asr-read-aloud");
    expect(idleCard?.textContent).toContain("打开一篇笔记");
    const idleButton = idleCard?.querySelector<HTMLButtonElement>("button");
    expect(idleButton?.disabled).toBe(true);

    document.body.replaceChildren();
    const base = plugin({ readAloudTarget: async () => { calls.push("start"); } });
    (base.uiState as Record<string, unknown>).readAloudTargetPath = "Notes/周报.md";
    const ready = viewFor(base);
    await ready.onOpen();
    const card = ready.contentEl.querySelector(".crisp-asr-read-aloud");
    expect(card?.textContent).toContain("周报.md");
    const buttons = Array.from(card?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    expect(buttons.map((b) => b.textContent)).toEqual(["朗读当前笔记"]);
    buttons[0].click();
    expect(calls).toEqual(["start"]);
  });

  it("turns the read-aloud card into playback controls while reading", async () => {
    const calls: string[] = [];
    const base = plugin({
      toggleReadAloudPause: () => { calls.push("toggle"); },
      stopReadAloud: () => { calls.push("stop"); },
    });
    (base.uiState as Record<string, unknown>).readAloudTargetPath = "Notes/周报.md";
    (base.uiState as Record<string, unknown>).readAloudStatus = { state: "paused", index: 1, total: 4 };
    const view = viewFor(base);
    await view.onOpen();
    const card = view.contentEl.querySelector(".crisp-asr-read-aloud");
    expect(card?.textContent).toContain("2/4 · 已暂停");
    const buttons = Array.from(card?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    expect(buttons.map((b) => b.textContent)).toEqual(["继续", "停止"]);
    buttons[0].click();
    buttons[1].click();
    expect(calls).toEqual(["toggle", "stop"]);
  });
});
