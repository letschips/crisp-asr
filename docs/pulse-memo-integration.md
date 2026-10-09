# Pulse 速记录音转写

录音转文字需要 Crisp Pulse 1.15.0 与 Crisp ASR 0.8.0 或更高版本；长按实时听写需要 Pulse 1.16.0 与 ASR 0.9.0。

在 Pulse 的录音速记卡片点击「转文字」。多个音频会显示各自的按钮。ASR 处理队列，Pulse 显示「排队中」「准备中」「转写中」「等待重试」；失败后可以点「重试转写」或「重试写回」。完成后，识别文字放进原速记，原文与音频保留。

该入口是手动动作，使用 ASR 当前语音识别引擎、密钥与授权；不更改 ASR 的输出位置设置，不启用自动转写，也不调用 AI 文本整理。缺少配置或授权时明确提示，不把任务当成成功。

## 接口与状态

- ASR `transcribeMemoAudio(file, {memoId, path})`：加入或复用已有速记转写任务，不打开 ASR 面板或别的笔记。
- ASR `getMemoTranscriptionJobs()`：返回速记任务快照；原有 `subscribe` 继续可用。`crisp-asr:state` workspace 事件通知 Pulse 刷新卡片操作区，避免每次状态变更重建输入框。
- 任务沿用 `sourcePath`、`targetPath`、`status` 等字段，增加稳定的 `memoId` 和可恢复的 `transcriptText`。识别成功先保存文字，再尝试写回。
- Pulse `validateMemoTranscriptionTarget` / `applyMemoTranscript`：按隐藏速记标识定位、核对音频引用，并通过 `Vault.process` 只追加到该速记块。原笔记改名时查找标识；速记或音频引用已删除时拒绝写回，结果仍保留在 ASR 队列。
- 「已转写」以速记里的隐藏凭据为准。录音被挪到别的文件夹时按文件名认出；同一段录音已有转写时不再写入第二段。用户删掉转写段落后，已完成的旧任务不再复用，可以重新转写。
- ASR 只在转写队列变化时广播 `crisp-asr:state`，电平和实时听写的界面刷新不会通知 Pulse。
- 速记任务遇到静音（豆包 `20000003`、Gemini 空结果）时给出检查麦克风权限的提示，不自动重试。
- 隐藏写回凭据同时记录任务与音频，防止重复点击、任务清理或完成状态保存中断后重复插入。识别结果中的 callout 标题与隐藏标识被转义，不能改变速记结构。

## 验证

跨插件磁盘工作流位于 Pulse 的 `tests/memo-asr.e2e.cjs`。在 Pulse 仓库执行 `npm run test:e2e:asr`；默认使用相邻 `crisp-asr` 源码，也可设置 `CRISP_ASR_REPO`。测试只在临时目录写文件，HTTP 返回值模拟，不使用真实密钥。

## 长按实时听写

- ASR `startMemoDictation(sink)`：开始一次速记听写，连上后 resolve；无法开始时 reject（正在给笔记听写、缺少密钥或未激活）。`sink.onState` 报告 connecting / listening / finishing，`sink.onText(text, preview)` 推送已定稿文字和未定稿的尾巴，`sink.onDone({text, error?})` 在开始成功后恰好调用一次；连接前被取消时 text 为空。
- ASR `stopMemoDictation()`：结束速记听写，连接中则取消；不影响笔记听写。
- 速记听写不绑定当前笔记、不打开 ASR 面板、不保存实时录音；崩溃恢复草稿照常保存，结束后清除。
- Pulse 的麦克风按钮：轻点录音，按住超过 0.35 秒听写，松开、触摸被系统打断或丢失指针捕获时结束；长按后的 click 不会再触发录音。

保留普通文件转写与实时听写的现有行为。当前不支持自动速记转写或 AI 整理联动。
