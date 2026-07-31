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
import { verifyLicenseCode } from "./license";

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
      text: "连接豆包语音，把录音和实时声音直接沉淀为 Markdown。",
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
      .setDesc("语音识别仍使用豆包；这里只控制转写后的文字处理。")
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
          ? "与豆包语音 Key 分开，由 Obsidian SecretStorage 安全保存。"
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
      "选择麦克风、电脑声音与可选原始音频保存",
      true,
    );

    new Setting(live)
      .setName("默认声音来源")
      .setDesc("电脑声音会打开 macOS 系统共享选择窗口。")
      .addDropdown((dropdown) => dropdown
        .addOption("microphone", "麦克风")
        .addOption("computer", "电脑声音")
        .addOption("computer-and-microphone", "电脑声音 + 麦克风")
        .setValue(this.plugin.settings.liveInputMode)
        .onChange(async (value) => {
          await this.plugin.setLiveInputMode(
            value === "computer" || value === "computer-and-microphone"
              ? value
              : "microphone",
          );
        }));

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
      .setName("自动转写 Obsidian 录音")
      .setDesc("检测到新的 Recording 音频附件后自动提交。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.autoTranscribeRecordings)
        .onChange(async (value) => {
          this.plugin.settings.autoTranscribeRecordings = value;
          await this.plugin.saveSettings();
        }));

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

    new Setting(workflow)
      .setName("快捷指令 URL")
      .setDesc(
        "使用 obsidian://crisp-asr?mode=toggle；mode 也支持 open、start、stop。",
      )
      .addButton((button) => button
        .setButtonText("复制 URL")
        .onClick(async () => {
          const vaultName = encodeURIComponent(this.app.vault.getName());
          const url = `obsidian://crisp-asr?vault=${vaultName}&action=record&mode=toggle`;
          await navigator.clipboard.writeText(url);
          new Notice("✅ 已复制快捷指令 URL 到剪贴板");
        }));

    const notice = containerEl.createDiv({ cls: "crisp-asr-privacy" });
    notice.createEl("strong", { text: "数据边界" });
    notice.createEl("p", {
      text: "启用转写后，所选文件、麦克风或经 macOS 明确授权的电脑声音会直接发送至火山引擎。只有手动点击智能处理时，原始转写文字才会发送至所选 AI 服务商。插件不自建中转服务器，也不会把 API Key 写入 data.json。",
    });

    renderAboutCard(
      containerEl,
      "Crisp ASR",
      "把录音、麦克风和电脑声音安静地转写成 Obsidian 笔记。",
    );
  }
}
