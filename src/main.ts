import { randomUUID } from "node:crypto";
import {
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  normalizePath,
  requestUrl,
  type Editor,
  type MarkdownFileInfo,
  type ObsidianProtocolData,
  type TAbstractFile,
} from "obsidian";
import {
  providerDisplayName,
  requestAiText,
  type AiHttpRequest,
  type AiHttpResponse,
} from "./ai-provider";
import {
  runAiProcessing,
  type AiProcessMode,
  type ProcessingMetadata,
} from "./ai-processing";
import { verifyLicenseCode } from "./license";
import { decodeAudioToPcmWav, isAudioPath, needsTranscoding } from "./audio";
import { LivePcmCapture } from "./audio-capture";
import {
  listMicrophoneDevices,
  microphoneAvailability,
  preservePreferredMicrophone,
  subscribeToMicrophoneChanges,
  type MicrophoneDevice,
} from "./audio-input";
import {
  CRISP_ASR_VIEW_TYPE,
  CrispAsrView,
} from "./asr-view";
import { transcribeFlash } from "./doubao-service";
import {
  buildSidecarPath,
  findAudioLinkNearCursor,
  matchesAutoTranscribeScope,
  resolveProtocolAction,
} from "./file-routing";
import { runConnectionProbe } from "./flash-client";
import {
  LiveAudioRecorder,
  assertLiveRecordingSupported,
} from "./live-recorder";
import {
  closeLiveResources,
  finishLiveResources,
  startLiveResources,
} from "./live-session";
import { CrispAsrLiveStrip } from "./live-strip";
import {
  SerializedPersistence,
  renderRecoveredTranscript,
  shouldCheckpointDraft,
  type PersistedLiveDraft,
} from "./live-draft";
import { MicrophoneTestSession } from "./microphone-test";
import { AsrServiceError, toAsrServiceError } from "./service-error";
import { CrispAsrSettingTab } from "./settings-tab";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type CrispAsrSettings,
  type PersistedFileJob,
} from "./settings";
import { DoubaoStreamingClient } from "./streaming-client";
import { SmartProcessingModal } from "./smart-modal";
import {
  extractLatestTranscript,
  renderSmartResultNote,
  upsertSmartResult,
} from "./smart-note";
import { TranscriptionQueue } from "./transcription-queue";
import { UntranscribedAudioModal } from "./untranscribed-modal";
import {
  extractTranscriptResult,
  renderLiveTranscriptBlock,
  renderTranscriptNote,
  TranscriptAccumulator,
  type TranscriptUtterance,
} from "./transcript";

const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

type UiMode =
  | "idle"
  | "connecting"
  | "listening"
  | "finishing"
  | "error";

export interface CrispAsrUiState {
  mode: UiMode;
  status: string;
  preview: string;
  finalized: TranscriptUtterance[];
  targetPath: string | null;
  jobs: PersistedFileJob[];
  microphones: MicrophoneDevice[];
  microphoneWarning: string;
  activeMicrophoneLabel: string;
  microphoneTestMode: "idle" | "testing";
  recoveryDraft: PersistedLiveDraft | null;
  inputLevel: number;
  smartTargetPath: string | null;
  smartMode: "idle" | "processing";
  smartProgress: string;
}

interface LiveSession {
  client: DoubaoStreamingClient;
  capture: LivePcmCapture;
  recorder?: LiveAudioRecorder;
  accumulator: TranscriptAccumulator;
  target: TFile | null;
  startedAt: string;
  startedAtMs: number;
  logId?: string;
  draftId: string;
}

export function findUntranscribedAudio(
  files: readonly { path: string }[],
  processedPaths: readonly string[],
  activeJobPaths: readonly string[],
): string[] {
  const processed = new Set(processedPaths);
  const active = new Set(activeJobPaths);
  return files
    .filter((file) => isAudioPath(file.path))
    .filter((file) => !processed.has(file.path))
    .filter((file) => !active.has(file.path))
    .map((file) => file.path)
    .sort((left, right) => left.localeCompare(right));
}

function sourceAudioPath(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  const wikiLink = trimmed.match(/^!?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/);
  const path = (wikiLink?.[1] ?? trimmed).trim();
  return isAudioPath(path) ? path : null;
}

export function collectTranscribedAudioPaths<TFileLike extends { path: string }>(
  metadataCache: {
    getFileCache: (file: TFileLike) => {
      frontmatter?: Record<string, unknown>;
    } | null;
  },
  markdownFiles: readonly TFileLike[],
): Set<string> {
  const paths = new Set<string>();
  for (const file of markdownFiles) {
    const path = sourceAudioPath(
      metadataCache.getFileCache(file)?.frontmatter?.source_audio,
    );
    if (path) {
      paths.add(path);
    }
  }
  return paths;
}

export default class CrispAsrPlugin extends Plugin {
  settings: CrispAsrSettings = { ...DEFAULT_SETTINGS };
  uiState: CrispAsrUiState = {
    mode: "idle",
    status: "就绪",
    preview: "",
    finalized: [],
    targetPath: null,
    jobs: [],
    microphones: [
      { deviceId: "default", label: "系统默认" },
    ],
    microphoneWarning: "",
    activeMicrophoneLabel: "",
    microphoneTestMode: "idle",
    recoveryDraft: null,
    inputLevel: 0,
    smartTargetPath: null,
    smartMode: "idle",
    smartProgress: "",
  };

  private readonly listeners = new Set<() => void>();
  private readonly autoTimers = new Set<number>();
  private readonly jobStatuses = new Map<string, PersistedFileJob["status"]>();
  private fileQueue: TranscriptionQueue | null = null;
  private liveSession: LiveSession | null = null;
  private liveStarting = false;
  private liveStartAbort: AbortController | null = null;
  private liveStopPromise: Promise<void> | null = null;
  private elapsedTimer: number | null = null;
  private statusBar: HTMLElement | null = null;
  private liveStrip: CrispAsrLiveStrip | null = null;
  private smartModal: SmartProcessingModal | null = null;
  private unloaded = false;
  private unsubscribeMicrophoneChanges: (() => void) | null = null;
  private microphoneTest: MicrophoneTestSession | null = null;
  private readonly persistence = new SerializedPersistence<CrispAsrSettings>(
    (settings) => this.saveData(settings),
  );
  private draftCheckpointTimer: number | null = null;
  private lastDraftPersistedAt = 0;
  private draftPersistenceWarned = false;
  private restoringDraftId: string | null = null;

  async onload(): Promise<void> {
    this.unloaded = false;
    const persistedSettings = await this.loadData();
    const legacy = persistedSettings
      && typeof persistedSettings === "object"
      && !Array.isArray(persistedSettings)
      ? persistedSettings as Record<string, unknown>
      : {};
    const legacyResourceId = typeof legacy.resourceId === "string"
      ? legacy.resourceId.trim()
      : "";
    const hasCurrentResourceId = typeof legacy.liveResourceId === "string"
      && legacy.liveResourceId.trim().length > 0;
    const settingsInput = legacyResourceId && !hasCurrentResourceId
      ? { ...legacy, liveResourceId: legacyResourceId }
      : persistedSettings;
    this.settings = normalizeSettings(settingsInput);
    this.uiState.recoveryDraft = this.settings.liveDraft;
    const mediaDevices = window.navigator.mediaDevices;
    if (mediaDevices) {
      this.unsubscribeMicrophoneChanges = subscribeToMicrophoneChanges(
        mediaDevices,
        () => {
          void this.stopMicrophoneTest();
          void this.refreshMicrophones(false);
        },
      );
      void this.refreshMicrophones(false);
    }
    let migratedLegacySettings = Boolean(
      legacyResourceId && !hasCurrentResourceId,
    );
    const legacyApiKey = typeof legacy.accessToken === "string"
      ? legacy.accessToken.trim()
      : "";
    if (!this.settings.apiKeySecretName && legacyApiKey) {
      const secretName = "crisp-asr-api-key";
      if (!this.app.secretStorage.getSecret(secretName)?.trim()) {
        this.app.secretStorage.setSecret(secretName, legacyApiKey);
      }
      this.settings.apiKeySecretName = secretName;
      migratedLegacySettings = true;
    }
    if (migratedLegacySettings) {
      await this.persistSettings();
    }
    this.uiState.jobs = this.settings.fileJobs;
    for (const job of this.settings.fileJobs) {
      this.jobStatuses.set(job.id, job.status);
    }
    this.fileQueue = new TranscriptionQueue(this.settings.fileJobs, {
      run: (job) => this.runFileJob(job),
      persist: async (jobs) => {
        this.settings.fileJobs = jobs;
        await this.persistSettings();
      },
      createId: () => randomUUID(),
      onChange: (jobs) => this.handleQueueChange(jobs),
    });
    this.liveStrip = new CrispAsrLiveStrip(
      this.app.workspace.containerEl.ownerDocument,
      {
        onOpen: () => void this.openView(),
        onStop: () => void this.stopLiveTranscription(),
      },
    );
    this.registerView(
      CRISP_ASR_VIEW_TYPE,
      (leaf) => new CrispAsrView(leaf, this),
    );
    this.addRibbonIcon("audio-lines", "打开 Crisp ASR", () => {
      void this.openView();
    });
    this.addCommand({
      id: "open",
      name: "打开转写面板",
      callback: () => void this.openView(),
    });
    this.addCommand({
      id: "start-live-transcription",
      name: "开始实时听写",
      callback: () => void this.startLiveTranscription(),
    });
    this.addCommand({
      id: "stop-live-transcription",
      name: "结束实时听写并写入笔记",
      checkCallback: (checking) => {
        const available = this.liveSession !== null;
        if (available && !checking) {
          void this.stopLiveTranscription();
        }
        return available;
      },
    });
    this.addCommand({
      id: "transcribe-active-audio",
      name: "转写当前音频文件",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const available = file instanceof TFile && isAudioPath(file.path);
        if (available && !checking) {
          void this.transcribeFile(file);
        }
        return available;
      },
    });
    this.addCommand({
      id: "scan-untranscribed-recordings",
      name: "扫描未转写录音并转写",
      callback: () => void this.scanUntranscribedRecordings(),
    });
    this.addCommand({
      id: "transcribe-audio-near-cursor",
      name: "转写光标附近的音频附件",
      editorCallback: (editor, view) => {
        void this.transcribeAudioNearCursor(editor, view);
      },
    });
    this.addCommand({
      id: "test-connection",
      name: "测试豆包 ASR 连接",
      callback: () => void this.testConnection(),
    });
    this.addCommand({
      id: "test-ai-connection",
      name: "测试 AI 文本处理连接",
      callback: () => void this.testAiConnection(),
    });
    this.addCommand({
      id: "polish-current-transcript",
      name: "润色整理当前转写",
      callback: () => void this.startSmartProcessing("polish"),
    });
    this.addCommand({
      id: "extract-current-transcript",
      name: "提炼当前转写重点",
      callback: () => void this.startSmartProcessing("extract"),
    });
    this.addCommand({
      id: "custom-process-current-transcript",
      name: "使用自定义 Prompt 处理当前转写",
      callback: () => void this.startSmartProcessing("custom"),
    });
    const protocolHandler = (params: ObsidianProtocolData): void => {
      void this.handleProtocolAction(params);
    };
    this.registerObsidianProtocolHandler("crisp-asr", protocolHandler);
    this.registerObsidianProtocolHandler("crisp-asr-record", protocolHandler);
    this.addSettingTab(new CrispAsrSettingTab(this.app, this));
    this.statusBar = this.addStatusBarItem();
    this.statusBar.addClass("crisp-asr-statusbar");

    this.registerEvent(this.app.workspace.on(
      "file-menu",
      (menu, file) => {
        if (!(file instanceof TFile) || !isAudioPath(file.path)) {
          return;
        }
        menu.addItem((item) => item
          .setTitle("使用 Crisp ASR 转写")
          .setIcon("audio-lines")
          .onClick(() => {
            const target = this.app.workspace.getActiveFile();
            void this.transcribeFile(
              file,
              target?.extension === "md" ? target : undefined,
            );
          }));
      },
    ));
    this.registerEvent(this.app.workspace.on(
      "active-leaf-change",
      () => {
        void this.refreshSmartTarget();
      },
    ));

    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) {
        return;
      }
      this.registerEvent(this.app.vault.on("create", (file) => {
        this.handleCreatedFile(file);
      }));
      if (this.getApiKey()) {
        void this.fileQueue?.start();
      }
      void this.refreshSmartTarget();
    });
    this.updateStatusBar();
  }

  async onunload(): Promise<void> {
    this.unloaded = true;
    this.unsubscribeMicrophoneChanges?.();
    this.unsubscribeMicrophoneChanges = null;
    await this.stopMicrophoneTest();
    this.liveStartAbort?.abort();
    this.liveStartAbort = null;
    this.fileQueue?.stop();
    for (const timer of this.autoTimers) {
      window.clearTimeout(timer);
    }
    this.autoTimers.clear();
    const session = this.liveSession;
    if (session) {
      await this.flushLiveDraft(session).catch(() => undefined);
      this.liveSession = null;
      session.recorder?.abort();
      await closeLiveResources(session);
    }
    if (this.elapsedTimer !== null) {
      window.clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
    this.liveStrip?.destroy();
    this.liveStrip = null;
    this.smartModal?.close();
    this.smartModal = null;
  }

  async ensureLicenseActivated(): Promise<boolean> {
    if (!this.settings.licenseCode) {
      new Notice("🔒 Crisp ASR 未激活，请先在设置中输入授权码激活后使用。");
      return false;
    }
    const check = await verifyLicenseCode(this.settings.licenseCode);
    if (!check.valid) {
      new Notice(`🔒 Crisp ASR 授权无效: ${check.reason || "未激活"}`);
      return false;
    }
    return true;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async saveSettings(): Promise<void> {
    this.settings = normalizeSettings(this.settings);
    await this.persistSettings();
    if (this.getApiKey()) {
      void this.fileQueue?.start();
    }
    this.emit();
  }

  private persistSettings(): Promise<void> {
    return this.persistence.enqueue(this.settings);
  }

  formatElapsed(): string {
    if (!this.liveSession) {
      return "00:00";
    }
    const seconds = Math.floor(
      (Date.now() - this.liveSession.startedAtMs) / 1_000,
    );
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${
      String(seconds % 60).padStart(2, "0")
    }`;
  }

  async openView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(CRISP_ASR_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false)
      ?? this.app.workspace.getLeaf("tab");
    if (!existing) {
      await leaf.setViewState({
        type: CRISP_ASR_VIEW_TYPE,
        active: true,
      });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  async testConnection(): Promise<void> {
    if (!(await this.ensureLicenseActivated())) return;
    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.showMissingKey();
      return;
    }
    new Notice("Crisp ASR：正在测试豆包连接…");
    try {
      await runConnectionProbe(apiKey, transcribeFlash);
      new Notice("Crisp ASR：豆包连接正常");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Crisp ASR 连接测试失败：${message}`, 8_000);
    }
  }

  async testAiConnection(): Promise<void> {
    if (!(await this.ensureLicenseActivated())) return;
    const apiKey = this.getAiApiKey();
    if (!apiKey) {
      this.showMissingAiKey();
      return;
    }
    new Notice("Crisp ASR：正在测试 AI 文本处理连接…");
    try {
      const result = await requestAiText({
        provider: this.settings.aiProvider,
        apiKey,
        model: this.settings.aiModel,
        baseUrl: this.settings.aiBaseUrl,
        systemPrompt: "这是连接测试。只回复 OK，不要输出其他内容。",
        userPrompt: "OK",
      }, (request) => this.sendAiHttpRequest(request));
      if (!result.trim()) {
        throw new Error("模型返回了空结果");
      }
      new Notice(
        `Crisp ASR：${
          providerDisplayName(this.settings.aiProvider)
        } 连接正常`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Crisp ASR AI 连接测试失败：${message}`, 8_000);
    }
  }

  async startSmartProcessing(mode: AiProcessMode): Promise<void> {
    if (!(await this.ensureLicenseActivated())) return;
    if (this.uiState.smartMode === "processing") {
      new Notice("Crisp ASR：已有智能处理任务正在运行");
      return;
    }
    const apiKey = this.getAiApiKey();
    if (!apiKey) {
      this.showMissingAiKey();
      return;
    }
    const target = await this.findSmartTarget();
    if (!target) {
      new Notice("请先打开一篇包含 Crisp ASR 转写内容的笔记", 6_000);
      return;
    }
    const modeLabel = this.smartModeLabel(mode);
    const metadata: ProcessingMetadata = {
      title: target.file.basename,
      date: new Date().toISOString().slice(0, 10),
    };
    this.smartModal?.close();
    const modal = new SmartProcessingModal(this.app, {
      title: modeLabel,
      original: target.transcript,
      run: async ({ signal, onProgress }) => {
        this.uiState.smartMode = "processing";
        this.uiState.smartProgress = "准备处理";
        this.emit();
        try {
          return await runAiProcessing({
            mode,
            transcript: target.transcript,
            customPrompt: this.settings.customPrompt,
            metadata,
            signal,
            onProgress: (current, total, label) => {
              this.uiState.smartProgress = total > 1
                ? `${label} · ${Math.min(current, total)}/${total}`
                : label;
              this.emit();
              onProgress(current, total, label);
            },
            generate: (prompts) => requestAiText({
              provider: this.settings.aiProvider,
              apiKey,
              model: this.settings.aiModel,
              baseUrl: this.settings.aiBaseUrl,
              systemPrompt: prompts.systemPrompt,
              userPrompt: prompts.userPrompt,
            }, (request) => this.sendAiHttpRequest(request)),
          });
        } finally {
          this.uiState.smartMode = "idle";
          this.uiState.smartProgress = "";
          this.emit();
        }
      },
      apply: async (result) => {
        await this.writeSmartResult(
          target.file,
          target.transcript,
          result,
          modeLabel,
        );
      },
    });
    this.smartModal = modal;
    modal.open();
  }

  async refreshMicrophones(requestPermission = true): Promise<void> {
    const mediaDevices = window.navigator.mediaDevices;
    if (!mediaDevices?.enumerateDevices) {
      new Notice("当前环境无法读取麦克风设备");
      return;
    }
    try {
      if (requestPermission && mediaDevices.getUserMedia) {
        const permissionStream = await mediaDevices.getUserMedia({
          audio: true,
        });
        for (const track of permissionStream.getTracks()) {
          track.stop();
        }
      }
      const listed = await listMicrophoneDevices(mediaDevices);
      const availability = microphoneAvailability(
        this.settings.microphoneDeviceId,
        listed,
      );
      const microphones = preservePreferredMicrophone(
        listed,
        this.settings.microphoneDeviceId,
      );
      this.uiState.microphones = microphones;
      this.uiState.microphoneWarning = availability === "missing"
        ? "已选麦克风当前不可用，开始时将使用系统默认"
        : "";
      this.emit();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Crisp ASR 无法读取麦克风：${message}`, 8_000);
    }
  }

  async setMicrophoneDevice(deviceId: string): Promise<void> {
    await this.stopMicrophoneTest();
    this.settings.microphoneDeviceId = deviceId || "default";
    await this.saveSettings();
  }

  async toggleMicrophoneTest(): Promise<void> {
    if (this.microphoneTest?.active) {
      await this.stopMicrophoneTest();
      return;
    }
    if (this.liveSession || this.liveStarting) {
      new Notice("请先结束实时听写再测试麦克风");
      return;
    }
    const session = new MicrophoneTestSession(window);
    this.microphoneTest = session;
    this.uiState.microphoneTestMode = "testing";
    this.uiState.activeMicrophoneLabel = "正在连接所选麦克风…";
    this.emit();
    try {
      await session.start(
        this.settings.microphoneDeviceId,
        (level) => {
          this.uiState.inputLevel = level;
          this.emit();
        },
        (input) => {
          this.uiState.activeMicrophoneLabel = input.label;
          if (input.usedDefaultFallback) {
            new Notice(
              `Crisp ASR：已选麦克风不可用，测试的是 ${input.label}`,
              8_000,
            );
          }
          this.emit();
        },
        () => {
          if (this.microphoneTest === session) {
            this.microphoneTest = null;
            this.uiState.microphoneTestMode = "idle";
            this.uiState.inputLevel = 0;
            this.emit();
          }
        },
      );
    } catch (error) {
      if (this.microphoneTest === session) {
        this.microphoneTest = null;
      }
      this.uiState.microphoneTestMode = "idle";
      this.uiState.inputLevel = 0;
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Crisp ASR 麦克风测试失败：${message}`, 8_000);
      this.emit();
    }
  }

  private async stopMicrophoneTest(): Promise<void> {
    const session = this.microphoneTest;
    this.microphoneTest = null;
    await session?.stop();
    this.uiState.microphoneTestMode = "idle";
    this.uiState.inputLevel = 0;
    this.emit();
  }

  async setSaveLiveAudio(value: boolean): Promise<void> {
    this.settings.saveLiveAudio = value;
    await this.saveSettings();
  }

  async transcribeAudioNearCursor(
    editor: Editor,
    view: MarkdownView | MarkdownFileInfo,
  ): Promise<void> {
    const link = findAudioLinkNearCursor(editor, editor.getCursor().line);
    if (!link) {
      new Notice("光标附近两行内没有找到音频附件");
      return;
    }
    const target = view.file;
    const source = this.app.metadataCache.getFirstLinkpathDest(
      link,
      target?.path ?? "",
    );
    if (!(source instanceof TFile) || !isAudioPath(source.path)) {
      new Notice(`找不到音频附件：${link}`);
      return;
    }
    await this.transcribeFile(source, target ?? undefined);
  }

  private async handleProtocolAction(
    params: ObsidianProtocolData,
  ): Promise<void> {
    const action = resolveProtocolAction(params);
    if (!action) {
      new Notice("Crisp ASR：不支持这个快捷指令模式");
      return;
    }
    if (action === "open") {
      await this.openView();
      return;
    }
    if (action === "start") {
      await this.startLiveTranscription();
      return;
    }
    if (action === "stop") {
      await this.stopLiveTranscription();
      return;
    }
    if (this.liveSession) {
      await this.stopLiveTranscription();
    } else {
      await this.startLiveTranscription();
    }
  }

  async transcribeFile(file: TFile, target?: TFile): Promise<void> {
    if (!(await this.ensureLicenseActivated())) return;
    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.showMissingKey();
      return;
    }
    await this.openView();
    const queued = await this.fileQueue?.enqueue(file.path, target?.path);
    if (!queued) {
      new Notice("这个音频已经在转写队列中");
      return;
    }
    await this.fileQueue?.start();
    new Notice(`Crisp ASR：${file.name} 已加入转写队列`);
  }

  async scanUntranscribedRecordings(): Promise<void> {
    if (!(await this.ensureLicenseActivated())) return;
    if (!this.getApiKey()) {
      this.showMissingKey();
      return;
    }
    await this.openView();
    const activeJobPaths = (this.fileQueue?.jobs() ?? [])
      .filter((job) => job.status !== "failed")
      .map((job) => job.sourcePath);
    const metadataCompleted = collectTranscribedAudioPaths(
      this.app.metadataCache,
      this.app.vault.getMarkdownFiles(),
    );
    const candidates = findUntranscribedAudio(
      this.app.vault.getFiles(),
      [...this.settings.processedAudioPaths, ...metadataCompleted],
      activeJobPaths,
    );
    if (candidates.length === 0) {
      new Notice("Crisp ASR：没有找到未转写的录音文件");
      return;
    }
    new UntranscribedAudioModal(
      this.app,
      candidates,
      (paths) => void this.enqueueUntranscribed(paths),
    ).open();
  }

  private async enqueueUntranscribed(paths: readonly string[]): Promise<void> {
    let added = 0;
    let skipped = 0;
    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) {
        continue;
      }
      const job = await this.fileQueue?.enqueue(file.path);
      if (job) {
        added += 1;
      } else {
        skipped += 1;
      }
    }
    await this.fileQueue?.start();
    new Notice(
      skipped > 0
        ? `Crisp ASR：已加入 ${added} 个录音（${skipped} 个已在队列中）`
        : `Crisp ASR：已加入 ${added} 个录音转写队列`,
    );
  }

  async retryFileJob(id: string): Promise<void> {
    if (!this.getApiKey()) {
      this.showMissingKey();
      return;
    }
    const queue = this.fileQueue;
    if (queue && await queue.retry(id)) {
      await queue.start();
    }
  }

  async removeFileJob(id: string): Promise<void> {
    await this.fileQueue?.remove(id);
  }

  async openFileJobResult(id: string): Promise<void> {
    const job = this.uiState.jobs.find((entry) => entry.id === id);
    if (!job?.outputPath) {
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(job.outputPath);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(file);
      this.uiState.smartTargetPath = file.path;
      this.emit();
    }
  }

  private async runFileJob(
    job: PersistedFileJob,
  ): Promise<{ outputPath: string }> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new AsrServiceError("豆包 API Key 未配置或已失效", false);
    }
    const source = this.app.vault.getAbstractFileByPath(job.sourcePath);
    if (!(source instanceof TFile) || !isAudioPath(source.path)) {
      throw new AsrServiceError(`找不到音频文件：${job.sourcePath}`, true);
    }
    const targetValue = job.targetPath
      ? this.app.vault.getAbstractFileByPath(job.targetPath)
      : null;
    const target = targetValue instanceof TFile ? targetValue : undefined;
    let audio: ArrayBuffer;
    try {
      const binary = await this.app.vault.readBinary(source);
      audio = needsTranscoding(source.path)
        ? await decodeAudioToPcmWav(binary, window)
        : binary;
    } catch (error) {
      throw toAsrServiceError(error, true);
    }
    if (audio.byteLength > MAX_AUDIO_BYTES) {
      throw new AsrServiceError(
        "处理后的音频超过豆包极速版 100MB 限制",
        false,
      );
    }
    const result = await transcribeFlash(apiKey, audio);
    const output = await this.writeFileTranscript(source, target, result);
    this.uiState.smartTargetPath = output.path;
    this.emit();
    this.rememberProcessed(source.path);
    return { outputPath: output.path };
  }

  async startLiveTranscription(): Promise<void> {
    await this.stopMicrophoneTest();
    if (!(await this.ensureLicenseActivated())) return;
    if (this.liveSession || this.liveStarting) {
      new Notice("实时听写已经开始");
      return;
    }
    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.showMissingKey();
      return;
    }
    if (this.settings.saveLiveAudio) {
      try {
        assertLiveRecordingSupported(window.MediaRecorder);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`Crisp ASR 无法保存实时录音：${message}`, 8_000);
        return;
      }
    }
    this.liveStarting = true;
    const startAbort = new AbortController();
    this.liveStartAbort = startAbort;
    const accumulator = new TranscriptAccumulator();
    const target = this.app.workspace.getActiveViewOfType(MarkdownView)?.file
      ?? null;
    const startedAt = new Date().toISOString();
    let sessionLogId: string | undefined;
    let startupError: Error | null = null;
    let inputEndedDuringStartup = false;
    const client = new DoubaoStreamingClient({
      apiKey,
      resourceId: this.settings.liveResourceId,
      onPayload: (payload) => {
        const result = extractTranscriptResult(payload);
        const update = accumulator.consume(result);
        this.uiState.preview = update.preview;
        this.uiState.finalized = accumulator.utterances();
        const activeSession = this.liveSession;
        if (update.added.length > 0 && activeSession?.accumulator === accumulator) {
          this.scheduleLiveDraftCheckpoint(activeSession);
        }
        this.emit();
      },
      onError: (error) => {
        if (this.liveSession) {
          void this.stopLiveTranscription(error);
        } else {
          startupError = error;
        }
      },
      onLogId: (logId) => {
        sessionLogId = logId;
        if (this.liveSession) {
          this.liveSession.logId = logId;
        }
      },
      onReconnecting: () => {
        this.uiState.status = "正在重连…";
        this.emit();
      },
      onReconnected: () => {
        this.uiState.status = "正在听写";
        this.emit();
      },
    });
    const capture = new LivePcmCapture(
      window,
      (packet) => client.sendAudio(packet),
      {
        microphoneDeviceId: this.settings.microphoneDeviceId,
        onLevel: (level) => {
          this.uiState.inputLevel = level;
          this.emit();
        },
        onInputEnded: () => {
          if (this.liveSession) {
            void this.stopLiveTranscription(
              new Error("音频输入已经结束，已保存当前转写"),
            );
          } else {
            inputEndedDuringStartup = true;
          }
        },
        onInputResolved: (input) => {
          this.uiState.activeMicrophoneLabel = input.label;
          if (input.usedDefaultFallback) {
            new Notice(
              `Crisp ASR：已选麦克风不可用，正在使用 ${input.label}`,
              8_000,
            );
          }
          this.emit();
        },
        ...(this.settings.silenceAction === "off"
          ? {}
          : {
            silenceDurationMs: this.settings.silenceDurationSeconds * 1_000,
            onSilence: () => {
              if (!this.liveSession) {
                return;
              }
              const message = `已持续静音 ${
                this.settings.silenceDurationSeconds
              } 秒，请检查麦克风或继续说话`;
              if (this.settings.silenceAction === "stop") {
                void this.stopLiveTranscription(new Error(message));
              } else {
                new Notice(`Crisp ASR：${message}`, 8_000);
              }
            },
          }),
      },
    );
    const recorder = this.settings.saveLiveAudio
      ? new LiveAudioRecorder({
        Recorder: window.MediaRecorder,
        adapter: this.app.vault.adapter,
        folder: this.settings.liveAudioFolder,
      })
      : undefined;
    const resources = {
      client,
      capture,
      ...(recorder ? { recorder } : {}),
    };
    this.uiState = {
      ...this.uiState,
      mode: "connecting",
      status: "连接中",
      preview: "",
      finalized: [],
      targetPath: target?.path ?? null,
      inputLevel: 0,
    };
    this.emit();
    const openingView = this.openView();
    try {
      await startLiveResources(resources, startAbort.signal);
      await openingView;
      if (startupError) {
        throw startupError;
      }
      this.liveSession = {
        client,
        capture,
        ...(recorder ? { recorder } : {}),
        accumulator,
        target,
        startedAt,
        startedAtMs: Date.now(),
        draftId: randomUUID(),
        ...(sessionLogId ? { logId: sessionLogId } : {}),
      };
      this.settings.liveDraft = {
        id: this.liveSession.draftId,
        startedAt,
        targetPath: target?.path ?? null,
        utterances: accumulator.utterances(),
        preview: this.uiState.preview,
        updatedAt: Date.now(),
      };
      this.uiState.recoveryDraft = null;
      this.lastDraftPersistedAt = 0;
      this.draftPersistenceWarned = false;
      await this.persistLiveDraft();
      this.uiState.mode = "listening";
      this.uiState.status = "正在听写";
      this.elapsedTimer = window.setInterval(() => this.emit(), 1_000);
      this.emit();
      if (inputEndedDuringStartup) {
        await this.stopLiveTranscription(
          new Error("音频输入已经结束，已保存当前转写"),
        );
      }
    } catch (error) {
      await openingView.catch(() => undefined);
      recorder?.abort();
      await closeLiveResources(resources);
      if (startAbort.signal.aborted || this.unloaded) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.uiState.mode = "error";
      this.uiState.status = "启动失败";
      this.uiState.inputLevel = 0;
      this.emit();
      new Notice(`Crisp ASR 无法开始听写：${message}`, 8_000);
    } finally {
      if (this.liveStartAbort === startAbort) {
        this.liveStartAbort = null;
      }
      this.liveStarting = false;
    }
  }

  async stopLiveTranscription(reason?: Error): Promise<void> {
    if (this.liveStopPromise) {
      return this.liveStopPromise;
    }
    const session = this.liveSession;
    if (!session) {
      if (this.liveStarting && this.liveStartAbort) {
        this.liveStartAbort.abort();
        this.uiState.mode = "idle";
        this.uiState.status = "就绪";
        this.uiState.inputLevel = 0;
        this.emit();
      }
      return;
    }
    const stopping = this.finishLiveSession(session, reason);
    this.liveStopPromise = stopping.finally(() => {
      this.liveStopPromise = null;
    });
    return this.liveStopPromise;
  }

  private async finishLiveSession(
    session: LiveSession,
    reason?: Error,
  ): Promise<void> {
    this.uiState.mode = "finishing";
    this.uiState.status = "正在收尾";
    this.emit();
    if (this.elapsedTimer !== null) {
      window.clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
    try {
      await this.flushLiveDraft(session);
      const result = await finishLiveResources(session);
      const text = session.accumulator.finalText().trim();
      if (text.length > 0) {
        const output = await this.writeLiveTranscript(
          session,
          text,
          result.audioPath,
        );
        this.uiState.smartTargetPath = output.path;
        new Notice("Crisp ASR：实时转写已写入笔记");
      } else if (result.audioPath) {
        new Notice(`Crisp ASR：录音已保存到 ${result.audioPath}`);
      } else {
        new Notice("Crisp ASR：这次没有识别到文字");
      }
      if (result.recordingError) {
        new Notice(
          `Crisp ASR：文字已保留，但录音保存失败：${
            result.recordingError.message
          }`,
          8_000,
        );
      }
      if (this.settings.liveDraft?.id === session.draftId) {
        this.settings.liveDraft = null;
        this.uiState.recoveryDraft = null;
        await this.persistSettings();
      }
      const terminalError = reason ?? result.finishError;
      if (terminalError) {
        new Notice(`Crisp ASR：${terminalError.message}`, 8_000);
      }
      this.uiState.mode = "idle";
      this.uiState.status = "就绪";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.uiState.mode = "error";
      this.uiState.status = "写入失败";
      this.uiState.recoveryDraft = this.settings.liveDraft;
      new Notice(`Crisp ASR 收尾失败：${message}`, 8_000);
    } finally {
      await closeLiveResources(session);
      if (this.liveSession === session) {
        this.liveSession = null;
      }
      this.uiState.targetPath = null;
      this.uiState.inputLevel = 0;
      this.emit();
    }
  }

  private updateLiveDraft(session: LiveSession): void {
    if (this.settings.liveDraft?.id !== session.draftId) {
      return;
    }
    this.settings.liveDraft = {
      ...this.settings.liveDraft,
      utterances: session.accumulator.utterances(),
      preview: this.uiState.preview,
      updatedAt: Date.now(),
    };
  }

  private scheduleLiveDraftCheckpoint(session: LiveSession): void {
    this.updateLiveDraft(session);
    const now = Date.now();
    if (shouldCheckpointDraft(this.lastDraftPersistedAt, now)) {
      void this.persistLiveDraft();
      return;
    }
    if (this.draftCheckpointTimer !== null) {
      return;
    }
    const remaining = Math.max(
      0,
      10_000 - (now - this.lastDraftPersistedAt),
    );
    this.draftCheckpointTimer = window.setTimeout(() => {
      this.draftCheckpointTimer = null;
      if (this.liveSession === session) {
        this.updateLiveDraft(session);
        void this.persistLiveDraft();
      }
    }, remaining);
  }

  private async persistLiveDraft(): Promise<void> {
    this.lastDraftPersistedAt = Date.now();
    try {
      await this.persistSettings();
      this.draftPersistenceWarned = false;
    } catch (error) {
      this.lastDraftPersistedAt = 0;
      if (!this.draftPersistenceWarned) {
        this.draftPersistenceWarned = true;
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`Crisp ASR 恢复草稿保存失败：${message}`, 8_000);
      }
    }
  }

  private async flushLiveDraft(session: LiveSession): Promise<void> {
    if (this.draftCheckpointTimer !== null) {
      window.clearTimeout(this.draftCheckpointTimer);
      this.draftCheckpointTimer = null;
    }
    this.updateLiveDraft(session);
    await this.persistLiveDraft();
  }

  async restoreLiveDraft(mode: "target" | "new-note"): Promise<void> {
    const draft = this.settings.liveDraft;
    if (!draft || this.restoringDraftId) {
      return;
    }
    this.restoringDraftId = draft.id;
    try {
      const content = renderRecoveredTranscript(draft);
      let output: TFile;
      const target = mode === "target" && draft.targetPath
        ? this.app.vault.getAbstractFileByPath(draft.targetPath)
        : null;
      if (target instanceof TFile) {
        await this.app.vault.process(target, (existing) => existing + content);
        output = target;
      } else {
        await this.ensureFolder(this.settings.outputFolder);
        const title = `恢复转写 ${draft.startedAt.slice(0, 16).replace("T", " ")}`;
        const preferred = normalizePath(
          `${this.settings.outputFolder}/${title.replace(/:/g, "-")}.md`,
        );
        output = await this.app.vault.create(
          this.nextAvailablePath(preferred),
          `---\ntype: Note\ncreated: "${draft.startedAt}"\nasr_provider: Doubao\nasr_status: Recovered\n---\n\n# ${title}${content}`,
        );
      }
      if (this.settings.liveDraft?.id === draft.id) {
        this.settings.liveDraft = null;
        this.uiState.recoveryDraft = null;
        await this.persistSettings();
      }
      await this.app.workspace.getLeaf(false).openFile(output);
      new Notice("Crisp ASR：已恢复实时转写");
      this.emit();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Crisp ASR 恢复失败：${message}`, 8_000);
    } finally {
      this.restoringDraftId = null;
    }
  }

  async discardLiveDraft(): Promise<void> {
    if (!this.settings.liveDraft || this.restoringDraftId) {
      return;
    }
    this.settings.liveDraft = null;
    this.uiState.recoveryDraft = null;
    await this.persistSettings();
    this.emit();
  }

  private getApiKey(): string | null {
    const secretName = this.settings.apiKeySecretName.trim();
    if (!secretName) {
      return null;
    }
    return this.app.secretStorage.getSecret(secretName)?.trim() || null;
  }

  private getAiApiKey(): string | null {
    const secretName = this.settings.aiApiKeySecretName.trim();
    if (!secretName) {
      return null;
    }
    return this.app.secretStorage.getSecret(secretName)?.trim() || null;
  }

  private showMissingKey(): void {
    new Notice("请先在 Crisp ASR 设置中选择或创建豆包 API Key", 6_000);
  }

  private showMissingAiKey(): void {
    new Notice(
      "请先在 Crisp ASR 设置中选择或创建 AI 文本处理 API Key",
      6_000,
    );
  }

  private smartModeLabel(mode: AiProcessMode): string {
    if (mode === "polish") {
      return "润色整理";
    }
    if (mode === "extract") {
      return "重点提炼";
    }
    return "自定义处理";
  }

  private async sendAiHttpRequest(
    request: AiHttpRequest,
  ): Promise<AiHttpResponse> {
    const response = await requestUrl({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: request.body,
      contentType: "application/json",
      throw: false,
    });
    let json: unknown = {};
    try {
      json = JSON.parse(response.text);
    } catch {
      json = response.json;
    }
    return {
      status: response.status,
      json,
      text: response.text,
    };
  }

  private async refreshSmartTarget(): Promise<void> {
    const target = await this.findSmartTarget();
    const path = target?.file.path ?? null;
    if (this.uiState.smartTargetPath !== path) {
      this.uiState.smartTargetPath = path;
      this.emit();
    }
  }

  private async findSmartTarget(): Promise<{
    file: TFile;
    transcript: string;
  } | null> {
    const candidates: TFile[] = [];
    const active = this.app.workspace.getActiveFile();
    if (active instanceof TFile && active.extension === "md") {
      candidates.push(active);
    }
    const persistedPath = this.uiState.smartTargetPath;
    if (persistedPath) {
      const persisted = this.app.vault.getAbstractFileByPath(persistedPath);
      if (
        persisted instanceof TFile
        && !candidates.some((file) => file.path === persisted.path)
      ) {
        candidates.push(persisted);
      }
    }
    const latestJob = [...this.uiState.jobs]
      .filter((job) => job.status === "completed" && job.outputPath)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    if (latestJob?.outputPath) {
      const latest = this.app.vault.getAbstractFileByPath(latestJob.outputPath);
      if (
        latest instanceof TFile
        && !candidates.some((file) => file.path === latest.path)
      ) {
        candidates.push(latest);
      }
    }
    for (const file of candidates) {
      try {
        const markdown = await this.app.vault.cachedRead(file);
        const transcript = extractLatestTranscript(markdown)?.text ?? "";
        if (transcript) {
          return { file, transcript };
        }
      } catch {
        // The file may have moved between workspace and vault reads.
      }
    }
    return null;
  }

  private async writeSmartResult(
    source: TFile,
    expectedTranscript: string,
    result: string,
    modeLabel: string,
  ): Promise<void> {
    if (this.settings.aiOutputMode === "same-note") {
      await this.app.vault.process(
        source,
        (content) => upsertSmartResult(
          content,
          expectedTranscript,
          result,
          modeLabel,
        ),
      );
      await this.app.workspace.getLeaf(false).openFile(source);
      this.uiState.smartTargetPath = source.path;
      this.emit();
      new Notice("Crisp ASR：智能整理已写入，原始转写保持不变");
      return;
    }
    await this.ensureFolder(this.settings.outputFolder);
    const title = `${source.basename} · 智能整理`;
    const preferred = normalizePath(
      `${this.settings.outputFolder}/${title}.md`,
    );
    const path = this.nextAvailablePath(preferred);
    const note = renderSmartResultNote({
      title,
      sourcePath: source.path,
      modeLabel,
      result,
      createdAt: new Date().toISOString(),
      provider: providerDisplayName(this.settings.aiProvider),
      model: this.settings.aiModel,
    });
    const created = await this.app.vault.create(path, note);
    await this.app.workspace.getLeaf(false).openFile(created);
    new Notice("Crisp ASR：已创建独立智能整理笔记");
  }

  private handleCreatedFile(file: TAbstractFile): void {
    if (
      !this.settings.autoTranscribeRecordings
      || !(file instanceof TFile)
      || !isAudioPath(file.path)
      || !matchesAutoTranscribeScope(
        file.path,
        this.settings.autoTranscribeScope,
        this.settings.autoTranscribeFolder,
      )
      || this.settings.processedAudioPaths.includes(file.path)
    ) {
      return;
    }
    const target = this.app.workspace.getActiveFile();
    const timer = window.setTimeout(() => {
      this.autoTimers.delete(timer);
      void this.transcribeFile(
        file,
        target?.extension === "md" ? target : undefined,
      );
    }, 800);
    this.autoTimers.add(timer);
  }

  private async writeFileTranscript(
    source: TFile,
    target: TFile | undefined,
    result: {
      text: string;
      utterances: TranscriptUtterance[];
      logId?: string;
    },
  ): Promise<TFile> {
    if (this.settings.outputMode === "current-note" && target) {
      const block = `\n\n## 音频转写 · ${source.basename}\n\n![[${source.path}]]\n\n${
        result.text.trim()
      }\n`;
      await this.app.vault.process(target, (content) => content + block);
      return target;
    }
    await this.ensureFolder(this.settings.outputFolder);
    const preferred = buildSidecarPath(
      this.settings.outputFolder,
      source.path,
    );
    const path = this.nextAvailablePath(preferred);
    const note = renderTranscriptNote({
      title: `${source.basename} 转写`,
      sourcePath: source.path,
      createdAt: new Date().toISOString(),
      text: result.text,
      utterances: result.utterances,
      logId: result.logId,
    });
    const created = await this.app.vault.create(path, note);
    await this.app.workspace.getLeaf(false).openFile(created);
    return created;
  }

  private async writeLiveTranscript(
    session: LiveSession,
    text: string,
    audioPath?: string,
  ): Promise<TFile> {
    const block = renderLiveTranscriptBlock({
      startedAt: session.startedAt,
      text,
      utterances: session.accumulator.utterances(),
      ...(audioPath ? { audioPath } : {}),
    });
    if (session.target) {
      const current = this.app.vault.getAbstractFileByPath(session.target.path);
      if (current instanceof TFile) {
        await this.app.vault.process(current, (content) => content + block);
        return current;
      }
    }
    await this.ensureFolder(this.settings.outputFolder);
    const title = `实时转写 ${session.startedAt.slice(0, 16).replace("T", " ")}`;
    const preferred = normalizePath(
      `${this.settings.outputFolder}/${title.replace(/:/g, "-")}.md`,
    );
    const path = this.nextAvailablePath(preferred);
    const created = await this.app.vault.create(
      path,
      `---\ntype: Note\ncreated: "${session.startedAt}"\nasr_provider: Doubao\n---\n\n# ${title}${block}`,
    );
    await this.app.workspace.getLeaf(false).openFile(created);
    return created;
  }

  private async ensureFolder(path: string): Promise<void> {
    const normalized = normalizePath(path);
    if (this.app.vault.getAbstractFileByPath(normalized)) {
      return;
    }
    const parts = normalized.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private nextAvailablePath(preferred: string): string {
    if (!this.app.vault.getAbstractFileByPath(preferred)) {
      return preferred;
    }
    const stem = preferred.replace(/\.md$/i, "");
    for (let index = 2; index < 1_000; index += 1) {
      const candidate = `${stem} ${index}.md`;
      if (!this.app.vault.getAbstractFileByPath(candidate)) {
        return candidate;
      }
    }
    throw new Error("无法为转写笔记分配唯一文件名");
  }

  private rememberProcessed(path: string): void {
    this.settings.processedAudioPaths = [
      ...this.settings.processedAudioPaths.filter((item) => item !== path),
      path,
    ].slice(-5_000);
  }

  private handleQueueChange(jobs: PersistedFileJob[]): void {
    this.settings.fileJobs = jobs;
    this.uiState.jobs = jobs;
    for (const job of jobs) {
      const previous = this.jobStatuses.get(job.id);
      if (previous !== job.status) {
        const name = job.sourcePath.split("/").pop() ?? job.sourcePath;
        if (job.status === "completed") {
          new Notice(`Crisp ASR：${name} 转写完成`);
        } else if (job.status === "failed") {
          new Notice(
            `Crisp ASR 转写失败：${job.lastError ?? "未知错误"}`,
            8_000,
          );
        }
      }
      this.jobStatuses.set(job.id, job.status);
    }
    const currentIds = new Set(jobs.map((job) => job.id));
    for (const id of this.jobStatuses.keys()) {
      if (!currentIds.has(id)) {
        this.jobStatuses.delete(id);
      }
    }
    this.emit();
  }

  private updateStatusBar(): void {
    if (!this.statusBar) {
      return;
    }
    if (this.uiState.mode === "listening") {
      this.statusBar.setText(`Crisp ASR · ${this.formatElapsed()}`);
      this.statusBar.show();
    } else {
      this.statusBar.hide();
    }
  }

  private emit(): void {
    this.updateStatusBar();
    const latest = this.uiState.finalized[
      this.uiState.finalized.length - 1
    ]?.text ?? "";
    this.liveStrip?.update({
      mode: this.uiState.mode,
      elapsed: this.formatElapsed(),
      preview: this.uiState.preview || latest,
    });
    for (const listener of this.listeners) {
      listener();
    }
  }
}
