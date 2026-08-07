// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { CrispAsrView } from "../src/asr-view";

function plugin(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    settings: {
      microphoneDeviceId: "bluetooth",
      saveLiveAudio: true,
      aiProvider: "ark",
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
      jobs: [],
    },
    subscribe: () => () => undefined,
    formatElapsed: () => "00:00",
    refreshMicrophones: async () => undefined,
    setMicrophoneDevice: async () => undefined,
    setSaveLiveAudio: async () => undefined,
    startLiveTranscription: async () => undefined,
    stopLiveTranscription: async () => undefined,
    retryFileJob: async () => undefined,
    removeFileJob: async () => undefined,
    openFileJobResult: async () => undefined,
    startSmartProcessing: async () => undefined,
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

    const headers = Array.from(
      view.contentEl.querySelectorAll(".crisp-asr-field__header"),
    ).map((element) => element.textContent?.trim());
    expect(headers).toEqual(["麦克风"]);
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
      "润色整理",
      "重点提炼",
      "自定义",
    ]);
    for (const button of buttons) {
      button.click();
    }
    await Promise.resolve();
    expect(calls).toEqual(["polish", "extract", "custom"]);
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
});
