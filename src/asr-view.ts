import {
  ItemView,
  setIcon,
  type WorkspaceLeaf,
} from "obsidian";
import type CrispAsrPlugin from "./main";
import type { PersistedFileJob } from "./settings";

export const CRISP_ASR_VIEW_TYPE = "crisp-asr";

interface ViewSnapshot {
  mode: string;
  status: string;
  preview: string;
  targetPath: string | null;
  finalized: readonly unknown[];
  jobs: readonly unknown[];
  microphones: readonly unknown[];
  microphoneDeviceId: string;
  saveLiveAudio: boolean;
  smartTargetPath: string | null;
  smartMode: string;
  smartProgress: string;
  elapsed: string;
}

function formatJobMessage(job: PersistedFileJob): string {
  const attempt = job.attempt > 0 ? ` · 第 ${job.attempt} 次` : "";
  switch (job.status) {
    case "queued":
      return "等待转写";
    case "preparing":
      return `正在准备音频${attempt}`;
    case "transcribing":
      return `豆包识别中${attempt}`;
    case "retry-wait":
      return `等待自动重试${attempt} · ${job.lastError ?? "临时错误"}`;
    case "completed":
      return job.outputPath ? `已写入 ${job.outputPath}` : "转写完成";
    case "failed":
      return `失败${attempt} · ${job.lastError ?? "未知错误"}`;
  }
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function createButton(
  container: HTMLElement,
  label: string,
  icon: string,
  className: string,
  onClick: () => void,
  disabled = false,
): HTMLButtonElement {
  const button = container.ownerDocument.createElement("button");
  button.className = `crisp-asr-button ${className}`;
  button.type = "button";
  button.disabled = disabled;
  const iconElement = container.ownerDocument.createElement("span");
  iconElement.className = "crisp-asr-button__icon";
  setIcon(iconElement, icon);
  const labelElement = container.ownerDocument.createElement("span");
  labelElement.textContent = label;
  button.append(iconElement, labelElement);
  button.addEventListener("click", onClick);
  container.append(button);
  return button;
}

export class CrispAsrView extends ItemView {
  private unsubscribe: (() => void) | null = null;
  private snapshot: ViewSnapshot | null = null;
  private levelMeter: HTMLElement | null = null;
  private levelFill: HTMLElement | null = null;
  private liveHeading: HTMLElement | null = null;
  private showAllJobs = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: CrispAsrPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return CRISP_ASR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Crisp ASR";
  }

  getIcon(): string {
    return "audio-lines";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("crisp-asr-view");
    this.unsubscribe = this.plugin.subscribe(() => this.update());
    this.update();
    void this.plugin.refreshMicrophones(false);
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.snapshot = null;
    this.levelMeter = null;
    this.levelFill = null;
    this.liveHeading = null;
  }

  private captureSnapshot(): ViewSnapshot {
    const state = this.plugin.uiState;
    return {
      mode: state.mode,
      status: state.status,
      preview: state.preview,
      targetPath: state.targetPath,
      finalized: state.finalized,
      jobs: state.jobs,
      microphones: state.microphones,
      microphoneDeviceId: this.plugin.settings.microphoneDeviceId,
      saveLiveAudio: this.plugin.settings.saveLiveAudio,
      smartTargetPath: state.smartTargetPath,
      smartMode: state.smartMode,
      smartProgress: state.smartProgress,
      elapsed: state.mode === "listening"
        ? this.plugin.formatElapsed()
        : "",
    };
  }

  private snapshotsMatch(left: ViewSnapshot, right: ViewSnapshot): boolean {
    return left.mode === right.mode
      && left.status === right.status
      && left.preview === right.preview
      && left.targetPath === right.targetPath
      && left.finalized === right.finalized
      && left.jobs === right.jobs
      && left.microphones === right.microphones
      && left.microphoneDeviceId === right.microphoneDeviceId
      && left.saveLiveAudio === right.saveLiveAudio
      && left.smartTargetPath === right.smartTargetPath
      && left.smartMode === right.smartMode
      && left.smartProgress === right.smartProgress;
  }

  private update(): void {
    const next = this.captureSnapshot();
    if (this.snapshot && this.snapshotsMatch(this.snapshot, next)) {
      this.updateLevelMeter();
      this.updateElapsed(next.elapsed);
      this.snapshot = next;
      return;
    }
    this.render(next);
    this.snapshot = next;
  }

  private updateLevelMeter(): void {
    const level = Math.max(0, Math.min(1, this.plugin.uiState.inputLevel));
    const percentage = Math.round(level * 100);
    if (this.levelMeter) {
      this.levelMeter.ariaLabel = `输入音量 ${percentage}%`;
    }
    if (this.levelFill) {
      this.levelFill.style.width = `${percentage}%`;
    }
  }

  private updateElapsed(elapsed: string): void {
    if (this.liveHeading && this.plugin.uiState.mode === "listening") {
      this.liveHeading.textContent = `实时听写 · ${elapsed}`;
    }
  }

  private render(snapshot: ViewSnapshot): void {
    const state = this.plugin.uiState;
    const document = this.contentEl.ownerDocument;
    const previousTranscript = this.contentEl.querySelector<HTMLElement>(
      ".crisp-asr-transcript__body",
    );
    const previousScrollTop = previousTranscript?.scrollTop ?? 0;
    const followedLatest = !previousTranscript
      || previousTranscript.scrollHeight
        - previousScrollTop
        - previousTranscript.clientHeight <= 24;
    this.contentEl.empty();
    this.levelMeter = null;
    this.levelFill = null;
    this.liveHeading = null;

    const shell = document.createElement("div");
    shell.className = "crisp-asr-shell";

    const header = document.createElement("header");
    header.className = "crisp-asr-header";
    const identity = document.createElement("div");
    identity.className = "crisp-asr-identity";
    const mark = document.createElement("span");
    mark.className = `crisp-asr-mark is-${state.mode}`;
    for (let index = 0; index < 4; index += 1) {
      mark.append(document.createElement("i"));
    }
    const heading = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = "Crisp ASR";
    const subtitle = document.createElement("p");
    subtitle.textContent = "把声音安静地落进笔记";
    heading.append(title, subtitle);
    identity.append(mark, heading);
    const badge = document.createElement("span");
    badge.className = `crisp-asr-status is-${state.mode}`;
    badge.textContent = state.status;
    header.append(identity, badge);

    const controls = document.createElement("section");
    controls.className = "crisp-asr-card crisp-asr-controls";
    const controlTitle = document.createElement("div");
    controlTitle.className = "crisp-asr-card__title";
    const controlHeading = document.createElement("strong");
    controlHeading.textContent = state.mode === "listening"
      ? `实时听写 · ${snapshot.elapsed}`
      : "实时听写";
    this.liveHeading = controlHeading;
    const controlDescription = document.createElement("span");
    controlDescription.textContent = state.targetPath
      ? `将写入 ${state.targetPath}`
      : state.mode === "connecting"
          || state.mode === "listening"
          || state.mode === "finishing"
        ? "结束后将创建一篇转写笔记"
        : "可直接开始；未打开笔记时会新建转写笔记";
    controlTitle.append(controlHeading, controlDescription);
    const actionRow = document.createElement("div");
    actionRow.className = "crisp-asr-actions";
    const sourceControls = document.createElement("div");
    sourceControls.className = "crisp-asr-source-controls";
    const locked = state.mode !== "idle" && state.mode !== "error";

    const microphoneField = document.createElement("label");
    microphoneField.className = "crisp-asr-field crisp-asr-microphone-field";
    const microphoneHeader = document.createElement("span");
    microphoneHeader.className = "crisp-asr-field__header";
    const microphoneLabel = document.createElement("span");
    microphoneLabel.textContent = "麦克风";
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "crisp-asr-device-refresh clickable-icon";
    refresh.ariaLabel = "刷新麦克风设备";
    refresh.disabled = locked;
    setIcon(refresh, "refresh-cw");
    refresh.addEventListener("click", () => {
      void this.plugin.refreshMicrophones(true);
    });
    microphoneHeader.append(microphoneLabel, refresh);
    const microphoneSelect = document.createElement("select");
    microphoneSelect.className = "crisp-asr-microphone dropdown";
    microphoneSelect.disabled = locked;
    for (const microphone of state.microphones) {
      const option = document.createElement("option");
      option.value = microphone.deviceId;
      option.textContent = microphone.label;
      microphoneSelect.append(option);
    }
    microphoneSelect.value = this.plugin.settings.microphoneDeviceId;
    microphoneSelect.addEventListener("change", () => {
      void this.plugin.setMicrophoneDevice(microphoneSelect.value);
    });
    microphoneField.append(microphoneHeader, microphoneSelect);
    sourceControls.append(microphoneField);

    const recordingRow = document.createElement("div");
    recordingRow.className = "crisp-asr-recording-row";
    const saveAudio = document.createElement("label");
    saveAudio.className = "crisp-asr-save-audio";
    const saveCheckbox = document.createElement("input");
    saveCheckbox.type = "checkbox";
    saveCheckbox.checked = this.plugin.settings.saveLiveAudio;
    saveCheckbox.disabled = locked;
    saveCheckbox.addEventListener("change", () => {
      void this.plugin.setSaveLiveAudio(saveCheckbox.checked);
    });
    const saveLabel = document.createElement("span");
    saveLabel.textContent = "保存本次原始音频";
    saveAudio.append(saveCheckbox, saveLabel);
    const level = document.createElement("div");
    level.className = "crisp-asr-level";
    level.ariaLabel = `输入音量 ${Math.round(state.inputLevel * 100)}%`;
    const levelFill = document.createElement("i");
    levelFill.className = "crisp-asr-level__fill";
    level.append(levelFill);
    this.levelMeter = level;
    this.levelFill = levelFill;
    this.updateLevelMeter();
    recordingRow.append(saveAudio, level);
    sourceControls.append(recordingRow);

    createButton(
      actionRow,
      "开始",
      "mic",
      "is-primary",
      () => void this.plugin.startLiveTranscription(),
      state.mode !== "idle" && state.mode !== "error",
    );
    createButton(
      actionRow,
      "结束并写入",
      "square",
      "is-secondary",
      () => void this.plugin.stopLiveTranscription(),
      state.mode !== "listening",
    );
    controls.append(controlTitle, sourceControls, actionRow);

    const transcript = document.createElement("section");
    transcript.className = "crisp-asr-card crisp-asr-transcript";
    const transcriptHeading = document.createElement("div");
    transcriptHeading.className = "crisp-asr-card__title";
    const transcriptTitle = document.createElement("strong");
    transcriptTitle.textContent = "转写流";
    const count = document.createElement("span");
    count.textContent = state.finalized.length > 0
      ? `${state.finalized.length} 个确定分句`
      : "等待声音";
    transcriptHeading.append(transcriptTitle, count);
    const transcriptBody = document.createElement("div");
    transcriptBody.className = "crisp-asr-transcript__body";
    if (state.finalized.length === 0 && !state.preview) {
      const empty = document.createElement("div");
      empty.className = "crisp-asr-empty";
      const emptyIcon = document.createElement("span");
      setIcon(emptyIcon, "audio-waveform");
      const emptyText = document.createElement("p");
      emptyText.textContent = "开始实时听写，或在文件列表右键音频进行转写。";
      empty.append(emptyIcon, emptyText);
      transcriptBody.append(empty);
    } else {
      for (const utterance of state.finalized) {
        const paragraph = document.createElement("p");
        paragraph.className = "crisp-asr-utterance";
        paragraph.textContent = utterance.text;
        transcriptBody.append(paragraph);
      }
      if (state.preview) {
        const preview = document.createElement("p");
        preview.className = "crisp-asr-utterance is-preview";
        preview.textContent = state.preview;
        transcriptBody.append(preview);
      }
    }
    transcript.append(transcriptHeading, transcriptBody);

    const smart = document.createElement("section");
    smart.className = "crisp-asr-card crisp-asr-smart";
    const smartHeading = document.createElement("div");
    smartHeading.className = "crisp-asr-card__title";
    const smartTitle = document.createElement("strong");
    smartTitle.textContent = "智能处理";
    const smartTarget = document.createElement("span");
    smartTarget.textContent = state.smartMode === "processing"
      ? state.smartProgress || "正在处理"
      : state.smartTargetPath
        ? basename(state.smartTargetPath)
        : "打开一篇转写笔记";
    smartHeading.append(smartTitle, smartTarget);
    const smartDescription = document.createElement("p");
    smartDescription.className = "crisp-asr-smart__description";
    smartDescription.textContent = state.smartTargetPath
      ? "手动调用所选 AI；写入前可预览，原始转写不会被覆盖。"
      : "完成一次转写，或打开已有的 Crisp ASR 转写笔记。";
    const smartActions = document.createElement("div");
    smartActions.className = "crisp-asr-smart-actions";
    const smartDisabled = !state.smartTargetPath
      || state.smartMode === "processing";
    createButton(
      smartActions,
      "润色整理",
      "wand-sparkles",
      "is-secondary",
      () => void this.plugin.startSmartProcessing("polish"),
      smartDisabled,
    );
    createButton(
      smartActions,
      "重点提炼",
      "list-checks",
      "is-secondary",
      () => void this.plugin.startSmartProcessing("extract"),
      smartDisabled,
    );
    createButton(
      smartActions,
      "自定义",
      "sliders-horizontal",
      "is-secondary",
      () => void this.plugin.startSmartProcessing("custom"),
      smartDisabled,
    );
    smart.append(smartHeading, smartDescription, smartActions);

    const jobs = document.createElement("section");
    jobs.className = "crisp-asr-card crisp-asr-jobs";
    const jobsHeading = document.createElement("div");
    jobsHeading.className = "crisp-asr-card__title";
    const jobsTitle = document.createElement("strong");
    jobsTitle.textContent = "最近任务";
    const jobsMeta = document.createElement("div");
    jobsMeta.className = "crisp-asr-jobs__meta";
    const jobsCount = document.createElement("span");
    jobsCount.textContent = state.jobs.length > 0
      ? `${state.jobs.length} 项`
      : "暂无";
    jobsMeta.append(jobsCount);
    if (state.jobs.length > 5) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "crisp-asr-jobs__toggle";
      toggle.textContent = this.showAllJobs ? "收起" : "查看全部";
      toggle.setAttribute("aria-expanded", String(this.showAllJobs));
      toggle.addEventListener("click", () => {
        this.showAllJobs = !this.showAllJobs;
        this.snapshot = null;
        this.update();
      });
      jobsMeta.append(toggle);
    }
    jobsHeading.append(jobsTitle, jobsMeta);
    jobs.append(jobsHeading);
    const orderedJobs = [...state.jobs]
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const recentJobs = this.showAllJobs ? orderedJobs : orderedJobs.slice(0, 5);
    for (const job of recentJobs) {
      const row = document.createElement("div");
      row.className = `crisp-asr-job is-${job.status}`;
      const jobIcon = document.createElement("span");
      setIcon(
        jobIcon,
        job.status === "completed"
          ? "check"
          : job.status === "failed"
            ? "triangle-alert"
            : "loader-circle",
      );
      const jobInfo = document.createElement("div");
      const jobName = document.createElement("strong");
      jobName.textContent = basename(job.sourcePath);
      const jobMessage = document.createElement("span");
      jobMessage.textContent = formatJobMessage(job);
      jobInfo.append(jobName, jobMessage);
      const jobActions = document.createElement("div");
      jobActions.className = "crisp-asr-job__actions";
      if (job.status === "failed") {
        const retry = document.createElement("button");
        retry.type = "button";
        retry.textContent = "重试";
        retry.addEventListener("click", () => {
          void this.plugin.retryFileJob(job.id);
        });
        jobActions.append(retry);
      }
      if (job.status === "completed" && job.outputPath) {
        const open = document.createElement("button");
        open.type = "button";
        open.textContent = "打开";
        open.addEventListener("click", () => {
          void this.plugin.openFileJobResult(job.id);
        });
        jobActions.append(open);
      }
      if (job.status === "completed" || job.status === "failed") {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "移除";
        remove.addEventListener("click", () => {
          void this.plugin.removeFileJob(job.id);
        });
        jobActions.append(remove);
      }
      row.append(jobIcon, jobInfo, jobActions);
      jobs.append(row);
    }

    shell.append(header, controls, transcript, smart, jobs);
    this.contentEl.append(shell);
    transcriptBody.scrollTop = followedLatest
      ? transcriptBody.scrollHeight
      : previousScrollTop;
  }
}
