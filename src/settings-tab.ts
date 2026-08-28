import {
  Notice,
  PluginSettingTab,
  SecretComponent,
  Setting,
  type App,
} from "obsidian";
import type CrispAsrPlugin from "./main";
import { renderAboutCard } from "./settings-about";
import type { AiProvider } from "./settings";
import type { SilenceAction, SilenceDurationSeconds } from "./settings";
import { verifyLicenseCode } from "./license";
import shortcutQrCode from "./assets/shortcut-qr.png";
import { DICTATION_PROFILES, type DictationProfileId } from "./dictation-profile";

const CRISP_SHORTCUT_URL =
  "https://www.icloud.com/shortcuts/b5c18553917b4f96bb302f88ccb2f0d4";

function createSettingGroup(
  container: HTMLElement,
  title: string,
  description: string,
  open: boolean,
): HTMLElement {
  const document = container.ownerDocument;
  const card = document.createElement("details");
  card.className = "crisp-asr-setting-card";
  card.open = open;
  const summary = document.createElement("summary");
  const info = document.createElement("span");
  const heading = document.createElement("strong");
  heading.textContent = title;
  const copy = document.createElement("span");
  copy.textContent = description;
  info.append(heading, copy);
  const chevron = document.createElement("i");
  summary.append(info, chevron);
  const content = document.createElement("div");
  content.className = "crisp-asr-setting-card__content";
  card.append(summary, content);
  container.append(card);
  return content;
}

export class CrispAsrSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: CrispAsrPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("crisp-asr-settings");
    const intro = containerEl.createDiv({ cls: "crisp-asr-settings__intro" });
    intro.createEl("h2", { text: "Crisp ASR" });
    intro.createEl("p", {
      text: "连接豆包或 Gemini，把录音和实时声音直接沉淀为 Markdown。",
    });

    // -----------------------------------------------------------------
    // 1. 软件授权组 (提升至最顶部)
    // -----------------------------------------------------------------
    const licenseGroup = createSettingGroup(
      containerEl,
      "软件授权 (必填)",
      "纯离线 Ed25519 密钥激活验证",
      true,
    );

    const statusSetting = new Setting(licenseGroup)
      .setName("当前激活状态")
      .setDesc("正在验证授权状态...");

    let isActivated = false;

    new Setting(licenseGroup)
      .setName("输入授权码")
      .setDesc("粘贴购买获取的授权字符串进行离线激活。")
      .addText((text) => text
        .setPlaceholder("粘贴授权码字符串...")
        .setValue(this.plugin.settings.licenseCode)
        .onChange(async (value) => {
          this.plugin.settings.licenseCode = value.trim();
          await this.plugin.saveSettings();
        }))
      .addButton((button) => button
        .setButtonText("激活 / 重新验证")
        .setCta()
        .onClick(async () => {
          const result = await verifyLicenseCode(this.plugin.settings.licenseCode);
          if (result.valid && result.payload) {
            new Notice(`🎉 激活成功！欢迎使用，${result.payload.userName}`);
            this.display();
          } else {
            new Notice(`❌ 激活失败: ${result.reason}`);
          }
        }));

    // 检查初始激活状态
    if (this.plugin.settings.licenseCode) {
      void verifyLicenseCode(this.plugin.settings.licenseCode).then((verifyRes) => {
        if (verifyRes.valid && verifyRes.payload) {
          isActivated = true;
          statusSetting.setDesc(
            `✅ 已激活（授权给: ${verifyRes.payload.userName}，到期时间: ${verifyRes.payload.expiresAt.split("T")[0]}）`,
          );
        } else {
          statusSetting.setDesc(
            `❌ 未激活（${verifyRes.reason || "授权码无效"}）`,
          );
        }
      });
    } else {
      statusSetting.setDesc("❌ 未激活（尚未输入授权码，请先在此激活）");
    }

    // -----------------------------------------------------------------
    // 2. 语音识别引擎选择
    // -----------------------------------------------------------------
    const engineGroup = createSettingGroup(
      containerEl,
      "语音识别引擎",
      "选择用于实时听写与录音文件转写的底层 STT 服务",
      true,
    );

    new Setting(engineGroup)
      .setName("当前引擎")
      .setDesc("支持火山引擎豆包或 Google Gemini 3.5 Transcribe。")
      .addDropdown((dropdown) => dropdown
        .addOption("doubao", "火山引擎 · 豆包 ASR")
        .addOption("gemini", "Google · Gemini 3.5 Transcribe")
        .setValue(this.plugin.settings.sttEngine)
        .onChange(async (value) => {
          this.plugin.settings.sttEngine = value as "doubao" | "gemini";
          await this.plugin.saveSettings();
          this.display();
        }));

    if (this.plugin.settings.sttEngine === "gemini") {
      // -----------------------------------------------------------------
      // 3. Gemini 3.5 Transcribe 连接与配置
      // -----------------------------------------------------------------
      const geminiGroup = createSettingGroup(
        containerEl,
        "Gemini 3.5 Transcribe 连接与配置",
        "文件最长 1 小时（说话人或词级时间戳最长 30 分钟）；实时单次会话最多 10 分钟，断线后自动重连",
        true,
      );

      new Setting(geminiGroup)
        .setName("Gemini API Key")
        .setDesc(
          isActivated
            ? "选择已有 Secret，或创建一个新的 Google Gemini API Key。"
            : "🔒 必须先在上方【软件授权】中激活 Crisp ASR 后才能配置 API Key。"
        )
        .addComponent((container) =>
          new SecretComponent(this.app, container)
            .setValue(this.plugin.settings.geminiApiKeySecretName)
            .onChange(async (value) => {
              if (!isActivated) {
                const check = await verifyLicenseCode(this.plugin.settings.licenseCode);
                if (!check.valid) {
                  new Notice("🔒 请先在上方【软件授权】中激活 Crisp ASR 软件！");
                  return;
                }
              }
              this.plugin.settings.geminiApiKeySecretName = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(geminiGroup)
        .setName("转写模式")
        .setDesc("Smart 自动去口头语并排版；Verbatim 忠实保留原始字词，并可选说话人或词级时间戳。")
        .addDropdown((dropdown) => dropdown
          .addOption("smart", "智能转写 (Smart · 自动修剪与排版)")
          .addOption("verbatim", "原始逐字 (Verbatim · 逐字稿与时间戳)")
          .setValue(this.plugin.settings.geminiMode)
          .onChange(async (value) => {
            this.plugin.settings.geminiMode = value as "smart" | "verbatim";
            await this.plugin.saveSettings();
            this.display();
          }));

      const isSmart = this.plugin.settings.geminiMode !== "verbatim";

      const diarizationSetting = new Setting(geminiGroup)
        .setName("区分说话人 (Diarization)")
        .setDesc(
          isSmart
            ? "⚠️ Smart 模式下已自动禁用（Google 官方规则：Smart 模式与说话人分离互斥）"
            : "在文件转写中自动识别并标注不同发言者 (Speaker 1, 2...)"
        )
        .addToggle((toggle) => toggle
          .setValue(!isSmart && this.plugin.settings.geminiIdentifySpeakers)
          .setDisabled(isSmart)
          .onChange(async (value) => {
            this.plugin.settings.geminiIdentifySpeakers = value;
            await this.plugin.saveSettings();
          }));
      if (isSmart) {
        diarizationSetting.settingEl.addClass("is-disabled");
      }

      const timestampSetting = new Setting(geminiGroup)
        .setName("词级时间戳 (Word Timestamps)")
        .setDesc(
          isSmart
            ? "⚠️ Smart 模式下已自动禁用（Google 官方规则：Smart 模式与词级时间戳互斥）"
            : "为转写文本生成精确词级起止时间戳"
        )
        .addToggle((toggle) => toggle
          .setValue(!isSmart && this.plugin.settings.geminiWordTimestamps)
          .setDisabled(isSmart)
          .onChange(async (value) => {
            this.plugin.settings.geminiWordTimestamps = value;
            await this.plugin.saveSettings();
          }));
      if (isSmart) {
        timestampSetting.settingEl.addClass("is-disabled");
      }

      new Setting(geminiGroup)
        .setName("Gemini 专属自定义词汇")
        .setDesc("可选：每行或逗号分隔专有名词（最多 1,000 条，建议不超过 100 条）。留空时自动复用下方的本地术语库。")
        .addTextArea((text) => text
          .setPlaceholder("Obsidian\nClaude\n产品名称\n人名")
          .setValue(this.plugin.settings.geminiCustomVocabulary)
          .onChange(async (value) => {
            this.plugin.settings.geminiCustomVocabulary = value.trim();
            await this.plugin.saveSettings();
          }));

      new Setting(geminiGroup)
        .setName("测试 Gemini 连接")
        .setDesc("验证 API Key 是否能访问 Gemini 3.5 Transcribe 模型信息；不消耗转写额度。")
        .addButton((button) => button
          .setButtonText("开始测试")
          .onClick(async () => {
            const check = await verifyLicenseCode(this.plugin.settings.licenseCode);
            if (!check.valid) {
              new Notice("🔒 请先在上方【软件授权】中激活 Crisp ASR 软件！");
              return;
            }
            await this.plugin.testConnection();
          }));
    } else {
      // -----------------------------------------------------------------
      // 2. 豆包连接组 (必须激活才能配置 Key)
      // -----------------------------------------------------------------
      const connection = createSettingGroup(
        containerEl,
        "豆包连接",
        "API Key 由 Obsidian SecretStorage 安全保存",
        true,
      );

      new Setting(connection)
        .setName("API Key")
        .setDesc(
          isActivated
            ? "选择已有 Secret，或创建一个新的豆包语音 API Key。"
            : "🔒 必须先在上方【软件授权】中激活 Crisp ASR 后才能配置 API Key。"
        )
        .addComponent((container) =>
          new SecretComponent(this.app, container)
            .setValue(this.plugin.settings.apiKeySecretName)
            .onChange(async (value) => {
              if (!isActivated) {
                const check = await verifyLicenseCode(this.plugin.settings.licenseCode);
                if (!check.valid) {
                  new Notice("🔒 请先在上方【软件授权】中激活 Crisp ASR 软件！");
                  return;
                }
              }
              this.plugin.settings.apiKeySecretName = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(connection)
        .setName("实时识别资源")
        .setDesc("默认使用豆包流式语音识别模型 2.0 小时版。")
        .addText((text) => text
          .setPlaceholder("volc.seedasr.sauc.duration")
          .setValue(this.plugin.settings.liveResourceId)
          .onChange(async (value) => {
            this.plugin.settings.liveResourceId = value.trim()
              || "volc.seedasr.sauc.duration";
            await this.plugin.saveSettings();
          }));

      new Setting(connection)
        .setName("测试连接")
        .setDesc("发送 0.1 秒静音样本，验证 API Key 与极速识别服务。")
        .addButton((button) => button
          .setButtonText("开始测试")
          .onClick(async () => {
            const check = await verifyLicenseCode(this.plugin.settings.licenseCode);
            if (!check.valid) {
              new Notice("🔒 请先在上方【软件授权】中激活 Crisp ASR 软件！");
              return;
            }
            await this.plugin.testConnection();
          }));
    }

    const recognition = createSettingGroup(
      containerEl,
      "口述场景与识别增强",
      this.plugin.settings.sttEngine === "gemini"
        ? "术语用于 Gemini 识别，场景用于后续创作"
        : "用场景、术语和当前笔记上下文提高识别与后续创作质量",
      true,
    );

    new Setting(recognition)
      .setName("默认口述场景")
      .setDesc("面板中也可在每次开始前切换。")
      .addDropdown((dropdown) => {
        for (const profile of DICTATION_PROFILES) dropdown.addOption(profile.id, `${profile.name} · ${profile.description}`);
        dropdown.setValue(this.plugin.settings.dictationProfileId);
        dropdown.onChange(async (value) => {
          await this.plugin.setDictationProfile(value as DictationProfileId);
          this.display();
        });
      });

    if (this.plugin.settings.dictationProfileId === "custom") {
      new Setting(recognition).setName("自定义场景名称").addText((text) => text
        .setValue(this.plugin.settings.customProfileName)
        .onChange(async (value) => { this.plugin.settings.customProfileName = value.trim(); await this.plugin.saveSettings(); }));
      new Setting(recognition).setName("场景上下文").setDesc(
        this.plugin.settings.sttEngine === "gemini"
          ? "用于分阶段创作；Gemini 识别只读取术语库。"
          : "帮助 ASR 理解正在谈论的主题。",
      )
        .addTextArea((text) => text.setValue(this.plugin.settings.customProfileContext).onChange(async (value) => {
          this.plugin.settings.customProfileContext = value.trim(); await this.plugin.saveSettings();
        }));
      new Setting(recognition).setName("创作要求").setDesc("用于分阶段创作的初稿阶段。")
        .addTextArea((text) => text.setValue(this.plugin.settings.customCreationPrompt).onChange(async (value) => {
          this.plugin.settings.customCreationPrompt = value.trim(); await this.plugin.saveSettings();
        }));
    }

    new Setting(recognition).setName("本地术语库").setDesc("每行或逗号分隔一个人名、品牌名或专业术语。")
      .addTextArea((text) => text.setPlaceholder("Crisp ASR\nWireless Mic RX").setValue(this.plugin.settings.hotwordsText).onChange(async (value) => {
        this.plugin.settings.hotwordsText = value.trim(); await this.plugin.saveSettings();
      }));
    if (this.plugin.settings.sttEngine !== "gemini") {
      new Setting(recognition).setName("火山热词 ID").setDesc("可选：填写控制台中创建的 boosting table ID。")
        .addText((text) => text.setValue(this.plugin.settings.boostingTableId).onChange(async (value) => {
          this.plugin.settings.boostingTableId = value.trim(); await this.plugin.saveSettings();
        }));
      new Setting(recognition).setName("使用当前笔记上下文").setDesc("开始听写时读取目标笔记标题和开头内容，用于识别上下文；默认关闭。")
        .addToggle((toggle) => toggle.setValue(this.plugin.settings.useActiveNoteContext).onChange(async (value) => {
          this.plugin.settings.useActiveNoteContext = value; await this.plugin.saveSettings();
        }));
      new Setting(recognition).setName("多人说话人分离").setDesc("文件转写优先使用；实时识别是否返回说话人取决于豆包资源能力。")
        .addToggle((toggle) => toggle.setValue(this.plugin.settings.identifySpeakers).onChange(async (value) => {
          this.plugin.settings.identifySpeakers = value; await this.plugin.saveSettings();
        }));
    }

    // -----------------------------------------------------------------
    // 3. AI 文本处理组
    // -----------------------------------------------------------------
    const ai = createSettingGroup(
      containerEl,
      "AI 文本处理",
      "转写完成后手动润色、提炼或执行自定义 Prompt",
      true,
    );
    new Setting(ai)
      .setName("AI 服务商")
      .setDesc("这里只控制转写后的文字处理，不会改变上方选择的语音识别引擎。")
      .addDropdown((dropdown) => dropdown
        .addOption("ark", "火山方舟")
        .addOption("openai", "OpenAI")
        .addOption("anthropic", "Claude")
        .addOption("deepseek", "DeepSeek")
        .addOption("custom", "自定义兼容接口")
        .setValue(this.plugin.settings.aiProvider)
        .onChange(async (value) => {
          const providers: AiProvider[] = [
            "ark",
            "openai",
            "anthropic",
            "deepseek",
            "custom",
          ];
          this.plugin.settings.aiProvider = providers.includes(
              value as AiProvider,
            )
            ? value as AiProvider
            : "ark";
          await this.plugin.saveSettings();
          this.display();
        }));

    new Setting(ai)
      .setName("AI API Key")
      .setDesc(
        isActivated
          ? "与语音识别 Key 分开，由 Obsidian SecretStorage 安全保存。"
          : "🔒 必须先在上方【软件授权】中激活 Crisp ASR 后才能配置 AI API Key。"
      )
      .addComponent((container) =>
        new SecretComponent(this.app, container)
          .setValue(this.plugin.settings.aiApiKeySecretName)
          .onChange(async (value) => {
            if (!isActivated) {
              const check = await verifyLicenseCode(this.plugin.settings.licenseCode);
              if (!check.valid) {
                new Notice("🔒 请先在上方【软件授权】中激活 Crisp ASR 软件！");
                return;
              }
            }
            this.plugin.settings.aiApiKeySecretName = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(ai)
      .setName("AI 模型")
      .setDesc("填写服务商控制台中的模型名称或接入点 ID。")
      .addText((text) => text
        .setPlaceholder(
          this.plugin.settings.aiProvider === "anthropic"
            ? "例如：Claude 模型名称"
            : "例如：服务商提供的模型 ID",
        )
        .setValue(this.plugin.settings.aiModel)
        .onChange(async (value) => {
          this.plugin.settings.aiModel = value.trim();
          await this.plugin.saveSettings();
        }));

    if (this.plugin.settings.aiProvider === "custom") {
      new Setting(ai)
        .setName("Base URL")
        .setDesc("填写 OpenAI Chat Completions 兼容服务的 API 根地址。")
        .addText((text) => text
          .setPlaceholder("https://llm.example.com/v1")
          .setValue(this.plugin.settings.aiBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.aiBaseUrl = value.trim().replace(
              /\/+$/g,
              "",
            );
            await this.plugin.saveSettings();
          }));
    }

    new Setting(ai)
      .setName("结果写入方式")
      .setDesc("默认插入当前转写笔记；原始转写始终保留。")
      .addDropdown((dropdown) => dropdown
        .addOption("same-note", "写入当前转写笔记")
        .addOption("new-note", "创建独立智能整理笔记")
        .setValue(this.plugin.settings.aiOutputMode)
        .onChange(async (value) => {
          this.plugin.settings.aiOutputMode = value === "new-note"
            ? "new-note"
            : "same-note";
          await this.plugin.saveSettings();
        }));

    new Setting(ai)
      .setName("自定义 Prompt")
      .setDesc(
        "支持 {{transcript}}、{{title}}、{{date}}、{{audio_file}}、{{duration}}；未写 transcript 变量时会自动附加原文。",
      )
      .addTextArea((text) => {
        text.inputEl.rows = 7;
        text.inputEl.classList.add("crisp-asr-custom-prompt");
        text.setPlaceholder(
          "例如：请整理为会议纪要，包含摘要、决定、行动项和待确认问题。\n\n{{transcript}}",
        );
        text.setValue(this.plugin.settings.customPrompt);
        text.onChange(async (value) => {
          this.plugin.settings.customPrompt = value.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(ai)
      .setName("测试 AI 连接")
      .setDesc("发送一条极短文本，验证 API Key、模型和接口配置。")
      .addButton((button) => button
        .setButtonText("开始测试")
        .onClick(async () => {
          const check = await verifyLicenseCode(this.plugin.settings.licenseCode);
          if (!check.valid) {
            new Notice("🔒 请先在上方【软件授权】中激活 Crisp ASR 软件！");
            return;
          }
          await this.plugin.testAiConnection();
        }));

    // -----------------------------------------------------------------
    // 4. 实时输入组
    // -----------------------------------------------------------------
    const live = createSettingGroup(
      containerEl,
      "实时输入",
      "选择麦克风与可选原始音频保存",
      true,
    );

    new Setting(live)
      .setName("默认声音来源")
      .setDesc(
        "仅支持麦克风。Obsidian 不支持直接捕获系统声音；"
        + "如需转写浏览器或 App 播放的声音，可用虚拟声卡（如 BlackHole）"
        + "把系统输出路由到麦克风后选择对应设备。",
      );

    new Setting(live)
      .setName("首选麦克风")
      .setDesc("设备不可用时自动退回系统默认麦克风。")
      .addDropdown((dropdown) => {
        for (const mic of this.plugin.uiState.microphones) {
          dropdown.addOption(mic.deviceId, mic.label);
        }
        dropdown.setValue(this.plugin.settings.microphoneDeviceId);
        dropdown.onChange(async (value) => {
          await this.plugin.setMicrophoneDevice(value);
        });
      })
      .addButton((button) => button
        .setIcon("refresh-cw")
        .setTooltip("刷新麦克风设备")
        .onClick(async () => {
          await this.plugin.refreshMicrophones(true);
          this.display();
        }));

    new Setting(live)
      .setName("保存实时原始音频")
      .setDesc("默认关闭；开启后保存实际发送给 ASR 的混合声音。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.saveLiveAudio)
        .onChange(async (value) => {
          await this.plugin.setSaveLiveAudio(value);
        }));

    const silenceDuration = new Setting(live)
      .setName("静音持续时间")
      .setDesc("连续低音量达到该时长后触发静音保护。")
      .addDropdown((dropdown) => dropdown
        .addOption("30", "30 秒")
        .addOption("60", "60 秒")
        .addOption("120", "120 秒")
        .setValue(String(this.plugin.settings.silenceDurationSeconds))
        .onChange(async (value) => {
          const duration = Number(value);
          this.plugin.settings.silenceDurationSeconds = (
            duration === 30 || duration === 120 ? duration : 60
          ) as SilenceDurationSeconds;
          await this.plugin.saveSettings();
        }));

    const updateSilenceDuration = (): void => {
      silenceDuration.settingEl.classList.toggle(
        "is-hidden",
        this.plugin.settings.silenceAction === "off",
      );
    };

    new Setting(live)
      .setName("静音保护")
      .setDesc("默认只提醒，不会因为停顿而擅自结束听写。")
      .addDropdown((dropdown) => dropdown
        .addOption("warn", "仅提醒")
        .addOption("stop", "自动结束并写入")
        .addOption("off", "关闭")
        .setValue(this.plugin.settings.silenceAction)
        .onChange(async (value) => {
          this.plugin.settings.silenceAction = (
            value === "stop" || value === "off" ? value : "warn"
          ) as SilenceAction;
          await this.plugin.saveSettings();
          updateSilenceDuration();
        }));
    updateSilenceDuration();

    new Setting(live)
      .setName("实时录音目录")
      .setDesc("使用 WebM/Opus，路径相对于当前 Vault。")
      .addText((text) => text
        .setPlaceholder("Crisp ASR/Audio")
        .setValue(this.plugin.settings.liveAudioFolder)
        .onChange(async (value) => {
          this.plugin.settings.liveAudioFolder = value.trim()
            || "Crisp ASR/Audio";
          await this.plugin.saveSettings();
        }));

    // -----------------------------------------------------------------
    // 5. 转写工作流组
    // -----------------------------------------------------------------
    const workflow = createSettingGroup(
      containerEl,
      "转写工作流",
      "控制内置录音监听和 Markdown 去向",
      true,
    );

    new Setting(workflow)
      .setName("自动转写新录音")
      .setDesc("新的音频文件落入 Obsidian 后自动加入转写队列。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.autoTranscribeRecordings)
        .onChange(async (value) => {
          this.plugin.settings.autoTranscribeRecordings = value;
          await this.plugin.saveSettings();
        }));

    new Setting(workflow)
      .setName("自动转写范围")
      .setDesc("选择哪些新音频文件会自动转写。")
      .addDropdown((dropdown) => dropdown
        .addOption("recording", "仅 Obsidian 录音机命名")
        .addOption("folder", "指定文件夹")
        .addOption("any", "任意音频文件")
        .setValue(this.plugin.settings.autoTranscribeScope)
        .onChange(async (value) => {
          this.plugin.settings.autoTranscribeScope =
            value === "folder" || value === "any" ? value : "recording";
          await this.plugin.saveSettings();
          updateFolderVisibility();
        }));

    const folderSetting = new Setting(workflow)
      .setName("监听文件夹")
      .setDesc("范围选择「指定文件夹」时生效；留空则不会自动转写。")
      .addText((text) => text
        .setPlaceholder("录音")
        .setValue(this.plugin.settings.autoTranscribeFolder)
        .onChange(async (value) => {
          this.plugin.settings.autoTranscribeFolder = value
            .replace(/^\/+|\/+$/g, "")
            .trim();
          await this.plugin.saveSettings();
        }));

    const updateFolderVisibility = (): void => {
      folderSetting.settingEl.classList.toggle(
        "is-hidden",
        this.plugin.settings.autoTranscribeScope !== "folder",
      );
    };
    updateFolderVisibility();

    new Setting(workflow)
      .setName("输出方式")
      .setDesc("独立笔记更安全；追加模式写入启动任务时的活动笔记。")
      .addDropdown((dropdown) => dropdown
        .addOption("sidecar", "创建独立转写笔记")
        .addOption("current-note", "追加到当前笔记")
        .setValue(this.plugin.settings.outputMode)
        .onChange(async (value) => {
          this.plugin.settings.outputMode = value === "current-note"
            ? "current-note"
            : "sidecar";
          await this.plugin.saveSettings();
        }));

    new Setting(workflow)
      .setName("转写笔记目录")
      .setDesc("独立转写笔记的 Vault 相对路径。")
      .addText((text) => text
        .setPlaceholder("Crisp ASR")
        .setValue(this.plugin.settings.outputFolder)
        .onChange(async (value) => {
          this.plugin.settings.outputFolder = value.trim() || "Crisp ASR";
          await this.plugin.saveSettings();
        }));

    const shortcutSetting = new Setting(workflow)
      .setName("获取 iPhone 快捷指令")
      .setDesc(
        "用 iPhone 相机扫描二维码（或点击二维码打开链接）即可添加「Crisp 录音」快捷指令。添加后把「存储文件」位置改成你自己的 Obsidian 库（iCloud Drive > Obsidian > 你的库 > 录音），详见插件文档。",
      );
    const shortcutLink = shortcutSetting.controlEl.createEl("a", {
      href: CRISP_SHORTCUT_URL,
      attr: { target: "_blank", rel: "noopener" },
    });
    shortcutLink.createEl("img", {
      attr: {
        src: shortcutQrCode,
        alt: "Crisp 录音快捷指令二维码",
        width: "112",
        height: "112",
      },
    });

    const notice = containerEl.createDiv({ cls: "crisp-asr-privacy" });
    notice.createEl("strong", { text: "数据边界" });
    notice.createEl("p", {
      text: `启用转写后，所选文件或麦克风的声音会直接发送至${
        this.plugin.settings.sttEngine === "gemini" ? " Google Gemini API" : "火山引擎"
      }。只有手动点击智能处理时，原始转写文字才会发送至所选 AI 服务商。插件不自建中转服务器，也不会把 API Key 写入 data.json。`,
    });

    renderAboutCard(
      containerEl,
      "Crisp ASR",
      "把录音和麦克风安静地转写成 Obsidian 笔记。",
    );
  }
}
