# Crisp ASR

Crisp ASR is a desktop-only Obsidian plugin by **letschips** that connects
directly to Doubao Speech Recognition.

## Version 0.5.0

- 新增自由口述、灵感速记、长文创作、视频口播、小红书、会议/访谈和自定义七种口述场景；面板可在每次开始前切换。
- 新增本地术语库、火山热词 ID 和可选当前笔记上下文，实时听写与文件转写共用识别增强配置。
- 实时听写中可标记重点、新段落和待确认，标记随异常恢复草稿保存并写入 Markdown。
- 新增用户手动触发的四阶段内容创作：净化原文、提取观点、生成场景化初稿、生成标题与钩子；写入前完整预览，原始转写不被覆盖。
- 文件转写可选说话人分离，以稳定标记写入笔记，并可从命令面板重命名说话人。

## Version 0.4.16

- 外接麦克风热插拔后自动刷新设备列表，保留暂时断开的首选设备；实时听写回退系统默认麦克风时会明确提示实际使用设备。
- 面板新增最长 10 秒的麦克风测试，只驱动音量条，不连接豆包、不上传或保存音频。
- 静音保护改为可配置：默认连续静音 60 秒仅提醒，也可选择自动结束并写入、关闭保护，时长支持 30/60/120 秒。
- 实时听写新增异常恢复草稿：确定分句会节流保存，异常退出或写入失败后可写回原笔记、创建恢复笔记或手动丢弃。
- 扫描未转写录音时识别笔记中的 `source_audio`，处理历史扩大到 5000 条，减少旧录音重复入队。
- `data.json` 写入改为不可变快照串行保存，避免设置、队列和恢复草稿并发更新时互相覆盖。

## Version 0.4.15

- 修复实时听写断线后的自动重连：意外断开不再被误判为用户主动结束，重连期间的麦克风音频会完整缓冲并在恢复后续传。
- 连接建立期间现在可以立即停止，不再出现“连接中”按钮无效；扫描录音弹窗也改为使用所属窗口的 DOM，兼容 Obsidian 独立窗口。
- Crisp 系列授权产品名单补齐 Crisp Organize 与 Crisp Base，并更新开发依赖与版本信息。

## Version 0.4.14

- 设置 → 转写工作流 新增「获取 iPhone 快捷指令」二维码入口：扫码即可把「Crisp 录音」快捷指令添加到 iPhone，替代原来的 obsidian:// 深链接复制按钮。
- 新增买家适配文档 [docs/iphone-shortcut-setup.md](docs/iphone-shortcut-setup.md)，说明如何把快捷指令的保存位置改成自己的 Obsidian 库。

## Version 0.4.13

- 「扫描未转写录音」：面板任务区新增扫描按钮，命令面板可搜「扫描未转写录音」；扫描全库音频，排除已转写与队列中的文件，弹出多选弹窗勾选批量入队。历史漏转/失败文件可一键捞回。
- 自动转写范围三档：仅 Obsidian 录音机命名（默认）/ 指定文件夹 / 任意音频文件。配合 iPhone 快捷指令或语音备忘录同步，可实现一键录音自动转写。
- 文件读取失败自动重试：iCloud 大文件同步未完成时队列会短退避重试，不再一次失败就卡死。

## iPhone 一键录音（快捷指令）

仓库 `shortcuts/` 目录提供已签名的 `Crisp 录音` 快捷指令：iPhone 上点一下开始录音，再点一下停止，文件自动进入 Obsidian 库，桌面端插件自动转写。

买家三步设置：

1. **导入快捷指令**：打开签名文件 → 添加。若系统提示不受信任，先在 系统设置 → 快捷指令 → 打开「允许不受信任的快捷指令」。
2. **设置保存位置（必须）**：快捷指令 → 「存储文件」→ 位置选 `iCloud Drive > Obsidian > 你的库 > 录音`。文件夹引用绑定账号，每个用户都需要选一次；库根没有 `录音` 文件夹就先建一个。
3. **插件设置**：设置 → 转写工作流 → 打开「自动转写新录音」→ 范围选「指定文件夹」→ 监听文件夹填 `录音`。

详细适配步骤（改保存位置、常见报错处理）见
[docs/iphone-shortcut-setup.md](docs/iphone-shortcut-setup.md)。

要求与说明：

- 手机与电脑需能同步同一个库（推荐 iCloud 同步；Obsidian Sync、Dropbox 等也可，前提是 iPhone 快捷指令的文件夹选择器能直接选到库文件夹，且 Mac 能看到同步结果）。纯 Mac 使用则不需要任何同步。
- 文件名不限（「指定文件夹」范围下任意文件名都会自动转写）。
- Mac 上录制输出为 `.wav`，iPhone 为 `.m4a`，插件均支持并会自动转码。

## Version 0.4.12

- 右侧面板布局打磨：声音来源移除后，麦克风选择改为全宽单列，统一卡片内边距与按钮对齐，电平条略增高更易读。

## Version 0.4.11

- 声音来源简化为仅麦克风：移除「电脑声音」与「电脑声音 + 麦克风」两个选项。Obsidian（Electron）不支持 `getDisplayMedia`，这两个模式在此环境中无法工作。老配置中的该字段会被忽略；如需转写系统声音（如浏览器视频），可用虚拟声卡（BlackHole 等）把系统输出路由到麦克风后选择对应设备。

## Version 0.4.10

- 电脑声音模式错误提示：Obsidian（Electron）不支持 `getDisplayMedia`，此前会直接报 `Not supported`。现在会给出明确提示，并建议改用麦克风模式或通过虚拟声卡（BlackHole 等）把系统声音路由到麦克风。

## Version 0.4.9

- 修复电脑声音模式回归：0.4.7 的 display media video track 优化在 Chrome/Electron 中会导致系统音频随 video track 一起停止，已回滚。

## Version 0.4.8

- 麦克风静音检测：实时听写期间连续 30 秒输入静音（RMS < 0.01）时自动停止会话并保存已有转写，提示用户麦克风可能已被系统静音或权限被撤销，不再持续计费无产出。

## Version 0.4.7

- WebSocket 自动重连：网络抖动导致连接断开时，自动尝试重连（最多 3 次，1s/2s/4s 退避），重连期间缓冲音频，成功后恢复听写，不再因瞬时断网丢失整场会话。
- 转写累积器排序缓存：`utterances()` 仅在有新增 finalized utterance 时排序，服务器推送但无新增时直接返回缓存数组，长录音（1 小时+）性能显著改善。
- 系统声音采集优化：获取 display media 后立即停止 video track，不再浪费 CPU/GPU 编码屏幕画面。

## Version 0.4.6

- 网络断开保护：WebSocket 意外关闭时通知用户（不再静默失败），已累积的转写文本仍能写入笔记。
- `sendAudio` 在连接断开后静默返回而非抛出异常，防止 `onaudioprocess` 回调中的静默错误和内存增长。
- `finishLiveResources` 中 `stopPcm()` 移入 try/catch，收尾失败不再阻止已累积转写的保存。
- 录音器 `onerror` 自动停止录音，避免错误后继续浪费资源。
- `finish()` 5 秒超时改为通知用户「末尾内容可能不完整」。

## Version 0.4.5

- WebSocket 连接超时保护：实时听写启动时如果豆包 ASR 服务器在 15 秒内未响应，自动断开并提示用户检查网络，不再永久卡在「连接中」状态。

## Version 0.4.4

Crisp ASR keeps Doubao Speech Recognition as the dedicated transcription
engine and adds an optional, separate AI text-processing layer.

### Manual smart processing

- Finish a file or live transcription first, then explicitly choose
  `润色整理`, `重点提炼`, or `自定义`.
- Nothing is sent to a text model until the user clicks one of those actions.
- `润色整理` corrects punctuation, paragraphs, obvious ASR errors, filler
  words, and mechanical repetition without removing meaningful information.
- `重点提炼` removes rambling and repetition, then organizes key facts,
  conclusions, decisions, action items, owners, dates, and open questions.
- `自定义` runs the saved Prompt with support for `{{transcript}}`,
  `{{title}}`, `{{date}}`, `{{audio_file}}`, and `{{duration}}`.

### Provider choice

- Choose 火山方舟, OpenAI, Claude, DeepSeek, or a custom OpenAI-compatible
  endpoint.
- Ark, OpenAI, DeepSeek, and custom endpoints use the Chat Completions
  contract. Claude uses the native Anthropic Messages contract.
- The text-model Secret and model name are independent from the Doubao Speech
  Recognition Secret.
- Provider presets keep their official Base URL. The custom provider accepts a
  user-supplied Base URL.
- A short connection test validates the selected Secret, model, and endpoint.

### Preview and raw-transcript protection

- Processing opens a side-by-side preview with the untouched transcript and
  generated result.
- Users can regenerate, copy, discard, or explicitly write the result.
- The default write mode inserts a marked `## 智能整理` section immediately
  before the raw ASR section.
- Re-running smart processing replaces only the previous generated section.
- If the raw transcript changes while generation is running, Crisp ASR refuses
  the write and asks the user to regenerate.
- An optional output mode creates a separate linked smart-result note instead.
- Long transcripts are split at readable boundaries and processed in order;
  multi-part key extraction receives a final consolidation pass.
- Cancelling stops the workflow between provider calls and never writes a
  partial result.

### Data boundary

- Audio files, microphone input, and explicitly authorized computer audio are
  sent only to Volcengine for speech recognition.
- Transcript text is sent only to the AI provider selected by the user and
  only after a manual smart-processing action.
- Both Speech and AI API keys are stored through Obsidian SecretStorage rather
  than plugin `data.json`.
- Crisp ASR does not operate a proxy server.

## Version 0.3.2

- Add `About Crisp ASR` to the bottom of the settings page with the plugin's
  core purpose and the linked author attribution.

- Update the input meter and elapsed time without rebuilding the full sidebar,
  and preserve transcript scroll position when new text arrives.
- Keep every persistent job reachable through an expandable task list.
- Retry Volcengine `55xxxxxx` temporary service failures even when the HTTP
  response itself is successful.
- Cancel an in-progress live startup cleanly when the plugin unloads.
- Clarify no-note output behavior and use the full control width for
  computer-only capture.
- Move a legacy Crisp ASR plaintext `accessToken` into Obsidian
  SecretStorage and preserve its live resource ID during the first upgraded
  load.

- Choose microphone, computer audio, or computer audio plus microphone for
  live transcription.
- Use the macOS sharing picker for every computer-audio session. Crisp ASR
  never starts system capture silently and never reads or stores shared video.
- Select a preferred microphone and monitor the mixed input level in the
  sidebar.
- Optionally preserve the exact mixed ASR input as WebM/Opus under
  `Crisp ASR/Audio`; this remains disabled by default.
- Embed a saved live recording in the resulting Markdown transcript.
- Persist file-transcription jobs across restarts and run them serially.
- Retry temporary network, timeout, rate-limit, and service failures twice.
  Permanent authentication, missing-file, decode, and size failures remain in
  the panel for manual retry or removal.
- Resume interrupted queued or running jobs after Obsidian reloads.

- Use neutral real-time dictation wording for meetings, interviews, voice
  notes, classes, and other recording contexts.
- Avoid nested backdrop-blur compositor layers in Obsidian's translucent
  macOS window, which caused expanding shadows and screen trails during live
  updates.
- Show a compact floating live strip with elapsed time, transcript preview,
  panel access, and a safe stop-and-write action.
- Test the configured API key from settings or the command palette with a
  100 ms silent probe.
- Transcribe an audio attachment within two lines of the editor cursor.
- Control the panel and live session through
  `obsidian://crisp-asr?mode=open|start|stop|toggle`.
- Stop microphone capture and close the stream automatically after a live
  connection error.
- Start V1 streaming audio at sequence 2 because the full client request
  already consumes sequence 1.
- Bundle the Node WebSocket client required to attach Doubao authentication
  headers from Obsidian Desktop.
- Right-click supported audio files in the file explorer to transcribe them.
- Detect new Obsidian `Recording …` attachments when automatic transcription
  is enabled.
- Convert M4A, WebM, FLAC, AAC, and other browser-decodable audio to 16 kHz
  mono PCM WAV before calling the Doubao flash endpoint.
- Show live microphone transcription in a Crisp-styled right sidebar and
  append the final result to the note that was active when recording started.
- Store the API key through Obsidian SecretStorage rather than plugin data.

The plugin sends selected files and explicitly authorized microphone or
computer audio directly to Volcengine. It does not run a proxy service.
