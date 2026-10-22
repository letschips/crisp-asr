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
import { DEEPSEEK_MODELS, DEFAULT_DEEPSEEK_MODEL } from "./ai-provider";
import shortcutQrCode from "./assets/shortcut-qr.png";
import { DICTATION_PROFILES, type DictationProfileId } from "./dictation-profile";
import {
  GEMINI_TTS_MODELS,
  GEMINI_TTS_VOICES,
  type GeminiTtsModel,
} from "./gemini-tts";

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
  info.append(heading);
  if (description) {
    const copy = document.createElement("span");
    copy.textContent = description;
    info.append(copy);
  }
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

    // -----------------------------------------------------------------
    // 1. 软件授权组 (提升至最顶部)
    // -----------------------------------------------------------------
    const licenseGroup = createSettingGroup(
      containerEl,
      "软件授权",
      "",
      true,
    );

    const statusSetting = new Setting(licenseGroup)
      .setName("当前激活状态")
      .setDesc("正在验证授权状态...");

    let isActivated = false;
    // 授权是异步验证的：先按未激活渲染，验证通过后再把这些说明改成激活后的文案。
    const lockedSettings: Array<[Setting, string]> = [];
    const lockable = (setting: Setting, activatedDesc: string): Setting => {
      lockedSettings.push([setting, activatedDesc]);
      return setting.setDesc(isActivated ? activatedDesc : "🔒 先激活 Crisp ASR");
    };

    new Setting(licenseGroup)
      .setName("输入授权码")
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
          for (const [setting, desc] of lockedSettings) setting.setDesc(desc);
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
      statusSetting.setDesc("❌ 未激活");
    }

    // -----------------------------------------------------------------
    // 2. 语音识别引擎选择
    // -----------------------------------------------------------------
    const engineGroup = createSettingGroup(
      containerEl,
      "语音识别引擎",
      "",
      true,
    );

    new Setting(engineGroup)
      .setName("当前引擎")
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
        "文件最长 1 小时，带说话人或时间戳 30 分钟；实时单次最多 10 分钟",
        true,
      );

      lockable(new Setting(geminiGroup).setName("Gemini API Key"), "")
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
        .setDesc("Smart 去口头语并排版；Verbatim 保留原字词")
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
            : ""
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
            : ""
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
        .setDesc("每行或逗号分隔，建议不超过 100 条；留空复用本地术语库")
        .addTextArea((text) => text
          .setPlaceholder("Obsidian\nClaude\n产品名称\n人名")
          .setValue(this.plugin.settings.geminiCustomVocabulary)
          .onChange(async (value) => {
            this.plugin.settings.geminiCustomVocabulary = value.trim();
            await this.plugin.saveSettings();
          }));

      new Setting(geminiGroup)
        .setName("测试 Gemini 连接")
        .setDesc("不消耗转写额度")
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
        "",
        true,
      );

      lockable(new Setting(connection).setName("API Key"), "")
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
        : "",
      true,
    );

    new Setting(recognition)
      .setName("默认口述场景")
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
          : "",
      )
        .addTextArea((text) => text.setValue(this.plugin.settings.customProfileContext).onChange(async (value) => {
          this.plugin.settings.customProfileContext = value.trim(); await this.plugin.saveSettings();
        }));
      new Setting(recognition).setName("创作要求").setDesc("用于分阶段创作的初稿阶段。")
        .addTextArea((text) => text.setValue(this.plugin.settings.customCreationPrompt).onChange(async (value) => {
          this.plugin.settings.customCreationPrompt = value.trim(); await this.plugin.saveSettings();
        }));
    }

    new Setting(recognition).setName("本地术语库").setDesc("每行或逗号分隔")
      .addTextArea((text) => text.setPlaceholder("Crisp ASR\nWireless Mic RX").setValue(this.plugin.settings.hotwordsText).onChange(async (value) => {
        this.plugin.settings.hotwordsText = value.trim(); await this.plugin.saveSettings();
      }));
    if (this.plugin.settings.sttEngine !== "gemini") {
      new Setting(recognition).setName("火山热词 ID").setDesc("控制台里的 boosting table ID")
        .addText((text) => text.setValue(this.plugin.settings.boostingTableId).onChange(async (value) => {
          this.plugin.settings.boostingTableId = value.trim(); await this.plugin.saveSettings();
        }));
      new Setting(recognition).setName("使用当前笔记上下文").setDesc("读取笔记标题和开头内容")
        .addToggle((toggle) => toggle.setValue(this.plugin.settings.useActiveNoteContext).onChange(async (value) => {
          this.plugin.settings.useActiveNoteContext = value; await this.plugin.saveSettings();
        }));
      new Setting(recognition).setName("多人说话人分离").setDesc("实时识别要看豆包资源是否支持")
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
      "",
      true,
    );
    new Setting(ai)
      .setName("AI 服务商")
      .setDesc("只用于转写后的文字处理")
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
          if (
            this.plugin.settings.aiProvider === "deepseek"
            && !this.plugin.settings.aiModel.startsWith("deepseek")
          ) {
            this.plugin.settings.aiModel = DEFAULT_DEEPSEEK_MODEL;
          }
          await this.plugin.saveSettings();
          this.display();
        }));

    lockable(new Setting(ai).setName("AI API Key"), "与语音识别 Key 分开")
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

    const deepseekPreset = DEEPSEEK_MODELS.some(
      ([id]) => id === this.plugin.settings.aiModel,
    );
    if (this.plugin.settings.aiProvider === "deepseek") {
      const modelSetting = new Setting(ai)
        .setName("AI 模型")
        .addDropdown((dropdown) => {
          for (const [id, label] of DEEPSEEK_MODELS) {
            dropdown.addOption(id, label);
          }
          dropdown
            .addOption("__custom__", "其他（手动填写）")
            .setValue(deepseekPreset ? this.plugin.settings.aiModel : "__custom__")
            .onChange(async (value) => {
              this.plugin.settings.aiModel = value === "__custom__" ? "" : value;
              await this.plugin.saveSettings();
              this.display();
            });
        });
      if (!deepseekPreset) {
        modelSetting.addText((text) => text
          .setPlaceholder(DEFAULT_DEEPSEEK_MODEL)
          .setValue(this.plugin.settings.aiModel)
          .onChange(async (value) => {
            this.plugin.settings.aiModel = value.trim();
            await this.plugin.saveSettings();
          }));
      }
      new Setting(ai)
        .setName("思考模式")
        .setDesc("开启后更慢、费用更高")
        .addDropdown((dropdown) => dropdown
          .addOption("off", "关闭（推荐）")
          .addOption("low", "开启 · 低")
          .addOption("high", "开启 · 高")
          .addOption("max", "开启 · 最高")
          .setValue(this.plugin.settings.aiThinking)
          .onChange(async (value) => {
            this.plugin.settings.aiThinking = value === "low"
              || value === "high"
              || value === "max"
              ? value
              : "off";
            await this.plugin.saveSettings();
          }));
    } else {
      new Setting(ai)
        .setName("AI 模型")
        .setDesc("模型名称或接入点 ID")
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
    }

    if (this.plugin.settings.aiProvider === "custom") {
      new Setting(ai)
        .setName("Base URL")
        .setDesc("OpenAI Chat Completions 兼容的根地址")
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
      .setDesc("原始转写始终保留")
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
    // 朗读（Gemini 3.8 TTS）
    // -----------------------------------------------------------------
    const tts = createSettingGroup(
      containerEl,
      "朗读",
      "",
      false,
    );

    new Setting(tts)
      .setName("Gemini API Key")
      .setDesc("与 Gemini 转写共用")
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

    new Setting(tts)
      .setName("朗读模型")
      .setDesc("Flash-Lite 更快更省，Flash 音质更好")
      .addDropdown((dropdown) => {
        for (const [id, label] of GEMINI_TTS_MODELS) dropdown.addOption(id, label);
        dropdown
          .setValue(this.plugin.settings.ttsModel)
          .onChange(async (value) => {
            this.plugin.settings.ttsModel = value as GeminiTtsModel;
            await this.plugin.saveSettings();
          });
      });

    new Setting(tts)
      .setName("音色")
      .addDropdown((dropdown) => {
        for (const [id, tone] of GEMINI_TTS_VOICES) dropdown.addOption(id, `${id} · ${tone}`);
        dropdown
          .setValue(this.plugin.settings.ttsVoice)
          .onChange(async (value) => {
            this.plugin.settings.ttsVoice = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(tts)
      .setName("朗读风格")
      .setDesc("留空最稳定")
      .addText((text) => text
        .setPlaceholder("例如：语速稍慢，平静")
        .setValue(this.plugin.settings.ttsStyle)
        .onChange(async (value) => {
          this.plugin.settings.ttsStyle = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(tts)
      .setName("试听")
      .setDesc("会消耗少量额度")
      .addButton((button) => button
        .setButtonText("试听")
        .onClick(async () => {
          await this.plugin.startReadAloud("你好，这是 Crisp ASR 的朗读试听。");
        }));

    // -----------------------------------------------------------------
    // 4. 实时输入组
    // -----------------------------------------------------------------
    const live = createSettingGroup(
      containerEl,
      "实时输入",
      "",
      true,
    );

    new Setting(live)
      .setName("默认声音来源")
      .setDesc(
        "仅支持麦克风；系统声音可用虚拟声卡（如 BlackHole）转成麦克风",
      );

    new Setting(live)
      .setName("首选麦克风")
      .setDesc("不可用时退回系统默认")
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
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.saveLiveAudio)
        .onChange(async (value) => {
          await this.plugin.setSaveLiveAudio(value);
        }));

    const silenceDuration = new Setting(live)
      .setName("静音持续时间")
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
      "",
      true,
    );

    new Setting(workflow)
      .setName("自动转写新录音")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.autoTranscribeRecordings)
        .onChange(async (value) => {
          this.plugin.settings.autoTranscribeRecordings = value;
          await this.plugin.saveSettings();
        }));

    new Setting(workflow)
      .setName("自动转写范围")
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
      .setDesc("留空则不自动转写")
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
      .setDesc("追加模式写入开始时的活动笔记")
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
        "扫码添加后，把「存储文件」位置改成你的库 > 录音",
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
