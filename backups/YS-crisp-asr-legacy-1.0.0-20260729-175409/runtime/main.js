/* ==========================================================================
   Crisp ASR - Volcengine Doubao Speech-to-Text Obsidian Plugin (v1.0.0)
   Crafted by letschips (Xiaohongshu)
   ========================================================================== */

const { Plugin, PluginSettingTab, Setting, Notice, TFile, MarkdownView, requestUrl } = require('obsidian');

const DEFAULT_SETTINGS = {
  appId: '',
  accessToken: '',
  resourceId: 'volc.bigasr.sauc.duration',
  modelName: 'bigmodel',
  audioFolder: 'Attachments/Audio',
  autoAppendCallout: true
};

class CrispAsrPlugin extends Plugin {
  async onload() {
    console.log('Loading Crisp ASR Plugin (v1.0.0)...');
    await this.loadSettings();

    this.isLiveRecording = false;
    this.audioContext = null;
    this.mediaStream = null;
    this.processor = null;
    this.recordedChunks = [];
    this.liveTimerInterval = null;
    this.liveStartTime = 0;
    this.floatingStripEl = null;
    this.wsClient = null;

    // 1. 注册设置界面
    this.addSettingTab(new CrispAsrSettingTab(this.app, this));

    // 2. 注册左侧 Ribbon 图标（快速录音按钮）
    this.addRibbonIcon('mic', 'Crisp ASR: 开始/停止 录音', () => {
      this.toggleRecordAndTranscribe();
    });

    // 3. 注册命令
    this.addCommand({
      id: 'crisp-asr-toggle-record',
      name: '🎙️ 开始/停止 一键录音转文字',
      callback: () => this.toggleRecordAndTranscribe()
    });

    this.addCommand({
      id: 'crisp-asr-live-stream',
      name: '📡 开启/停止 实时课堂听写流 (光标处打字机回显)',
      editorCallback: (editor) => this.toggleLiveStreamToEditor(editor)
    });

    this.addCommand({
      id: 'crisp-asr-transcribe-note-audio',
      name: '📝 转写当前笔记中光标附近的音频附件',
      editorCallback: (editor, view) => this.transcribeNoteAudioNearCursor(editor, view)
    });

    this.addCommand({
      id: 'crisp-asr-test-connection',
      name: '🧪 测试火山引擎 (豆包) ASR 连接状态',
      callback: () => this.testVolcConnection()
    });

    // 4. 注册文件右键菜单 (支持转写 Vault 内任意音频文件)
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFile && this.isAudioFile(file)) {
          menu.addItem((item) => {
            item
              .setTitle('Crisp ASR 转写此音频')
              .setIcon('audio-file')
              .onClick(() => this.transcribeVaultAudioFile(file));
          });
        }
      })
    );

    // 5. 注册 iPhone 快捷指令 (URL Protocol) 联动 handler
    this.registerObsidianProtocolHandler('crisp-asr-record', async (params) => {
      const mode = params.mode || 'toggle';
      if (mode === 'toggle') {
        new Notice('🎙️ Crisp ASR 快捷指令触发: 切换录音');
        await this.toggleRecordAndTranscribe();
      } else if (mode === 'live') {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
          this.toggleLiveStreamToEditor(view.editor);
        } else {
          new Notice('⚠️ 请先打开一篇 Markdown 笔记以接收听写流');
        }
      }
    });
  }

  onunload() {
    this.stopLiveStream();
    console.log('Unloaded Crisp ASR Plugin.');
  }

  isAudioFile(file) {
    const ext = file.extension ? file.extension.toLowerCase() : '';
    return ['mp3', 'm4a', 'wav', 'webm', 'aac', 'flac', 'ogg'].includes(ext);
  }

  // --------------------------------------------------------------------------
  // 火山引擎 豆包 ASR 极速版 Flash HTTP API (与 Resojot 机制一致)
  // --------------------------------------------------------------------------
  async transcribeAudioWithFlashApi(arrayBuffer, format = 'webm') {
    const apiKey = (this.settings.accessToken || '').trim();
    const resourceId = (this.settings.resourceId || 'volc.bigasr.sauc.duration').trim();
    const modelName = (this.settings.modelName || 'bigmodel').trim();

    if (!apiKey) {
      throw new Error('未在 Crisp ASR 设置中填写 Access Token');
    }

    // 将 ArrayBuffer 转 Base64
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i += 32768) {
      const chunk = bytes.subarray(i, i + 32768);
      binary += String.fromCharCode.apply(null, chunk);
    }
    const base64Data = btoa(binary);
    const requestId = 'crisp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

    const response = await requestUrl({
      url: 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
        'X-Api-Resource-Id': resourceId,
        'X-Api-Request-Id': requestId,
        'X-Api-Sequence': '-1'
      },
      body: JSON.stringify({
        user: { uid: 'crisp_user' },
        audio: {
          data: base64Data,
          format: format
        },
        request: {
          model_name: modelName,
          enable_itn: true,
          enable_punc: true
        }
      }),
      throwOnError: false
    });

    const resData = response.json || {};

    if (response.status === 401) {
      throw new Error('鉴权失败 (401): Access Token 不正确或失效');
    } else if (response.status === 403) {
      throw new Error('权限拒绝 (403): 请检查 Resource ID 或是否已开通服务');
    } else if (response.status !== 200) {
      const errMsg = resData.message || resData.error_msg || `HTTP Status ${response.status}`;
      throw new Error(`火山引擎 API 响应错误 (${response.status}): ${errMsg}`);
    }

    let resultText = '';
    if (resData.result && resData.result.text) {
      resultText = resData.result.text;
    } else if (resData.text) {
      resultText = resData.text;
    } else if (resData.utterances && Array.isArray(resData.utterances)) {
      resultText = resData.utterances.map(u => u.text || '').join('');
    }

    return resultText;
  }

  // --------------------------------------------------------------------------
  // 测试服务连接 (发送静音样本数据至 Flash HTTP API)
  // --------------------------------------------------------------------------
  async testVolcConnection() {
    const token = (this.settings.accessToken || '').trim();

    if (!token) {
      new Notice('⚠️ 请先填写 Access Token！');
      return;
    }

    new Notice('⏳ 正在测试火山引擎 (豆包) ASR 服务连接...');

    try {
      // 构造 0.1 秒 16kHz 单声道静音 WAV 音频包
      const sampleWavBuffer = this.createSilentWavBuffer(0.1, 16000);
      await this.transcribeAudioWithFlashApi(sampleWavBuffer, 'wav');
      new Notice('🎉 祝贺！火山引擎 (豆包) ASR 连接测试成功！接口响应正常！');
    } catch (e) {
      const msg = e.message || String(e);
      // 如果无语音被拦截也算连接通路成功
      if (msg.includes('no speech') || msg.includes('empty audio') || msg.includes('20000003')) {
        new Notice('🎉 祝贺！火山引擎 (豆包) ASR 接口连接正常！');
        return;
      }
      new Notice('❌ 连接测试失败: ' + msg);
    }
  }

  // 构造静音 WAV 文件 ArrayBuffer
  createSilentWavBuffer(durationSec, sampleRate) {
    const numSamples = Math.floor(durationSec * sampleRate);
    const dataSize = numSamples * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM Header Size
    view.setUint16(20, 1, true);  // Audio Format = 1 (PCM)
    view.setUint16(22, 1, true);  // Channels = 1
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);  // Block Align
    view.setUint16(34, 16, true); // Bits Per Sample
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    return buffer;
  }

  // --------------------------------------------------------------------------
  // 功能一：一键录音与转文字
  // --------------------------------------------------------------------------
  async toggleRecordAndTranscribe() {
    if (this.isLiveRecording) {
      await this.stopLiveStream();
      return;
    }

    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.recordedChunks = [];
        this.mediaRecorder = new MediaRecorder(stream);
        
        this.mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) this.recordedChunks.push(e.data);
        };

        this.mediaRecorder.start();
        new Notice('🎙️ Crisp ASR 录音已开始... (再次点击完成录音并转写)');
      } catch (err) {
        new Notice('❌ 无法访问麦克风: ' + (err.message || err));
      }
    } else {
      new Notice('⏳ 录音结束，正在保存音频并调用火山引擎转写...');
      this.mediaRecorder.onstop = async () => {
        const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
        const arrayBuffer = await blob.arrayBuffer();
        
        const audioFile = await this.saveAudioToVault(arrayBuffer);
        
        try {
          const text = await this.transcribeAudioWithFlashApi(arrayBuffer, 'webm');
          this.insertResultToActiveEditor(audioFile.path, text || '(未识别出有效文本)');
          new Notice('✅ Crisp ASR 语音转写完成！');
        } catch (e) {
          const errMsg = e.message || String(e);
          new Notice('❌ 转写失败: ' + errMsg);
          this.insertResultToActiveEditor(audioFile.path, `[转写失败: ${errMsg}]`);
        }
      };
      
      this.mediaRecorder.stop();
      if (this.mediaRecorder.stream) {
        this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
      }
    }
  }

  // --------------------------------------------------------------------------
  // 功能二：实时课堂听写流（打字机流式回显）
  // --------------------------------------------------------------------------
  async toggleLiveStreamToEditor(editor) {
    if (this.isLiveRecording) {
      await this.stopLiveStream();
      return;
    }

    if (!this.settings.accessToken) {
      new Notice('⚠️ 请先在插件设置中填写 Access Token！');
      return;
    }

    try {
      this.isLiveRecording = true;
      this.showFloatingStrip();
      new Notice('📡 Crisp ASR 实时听写流已启动...');

      let lastInsertedLen = 0;
      let committedText = '';

      this.wsClient = new VolcAsrWebSocketClient(this.settings, (text, isFinal) => {
        if (!editor) return;
        const cursor = editor.getCursor();
        
        if (isFinal) {
          committedText += text;
          if (lastInsertedLen > 0) {
            const startCursor = { line: cursor.line, ch: Math.max(0, cursor.ch - lastInsertedLen) };
            editor.replaceRange(text + ' ', startCursor, cursor);
          } else {
            editor.replaceRange(text + ' ', cursor);
          }
          lastInsertedLen = 0;
        } else {
          if (lastInsertedLen > 0) {
            const startCursor = { line: cursor.line, ch: Math.max(0, cursor.ch - lastInsertedLen) };
            editor.replaceRange(text, startCursor, cursor);
          } else {
            editor.replaceRange(text, cursor);
          }
          lastInsertedLen = text.length;
        }
      }, (err) => {
        console.error("Crisp ASR Streaming Error:", err);
      });

      await this.wsClient.connect();

      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      this.processor.onaudioprocess = (e) => {
        if (!this.isLiveRecording) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16Data = this.convertFloat32ToPCM16(inputData);
        if (this.wsClient) {
          this.wsClient.sendAudio(pcm16Data);
        }
      };

    } catch (e) {
      this.stopLiveStream();
      new Notice('❌ 启动听写流失败: ' + (e.message || e));
    }
  }

  stopLiveStream() {
    this.isLiveRecording = false;
    if (this.processor) {
      try { this.processor.disconnect(); } catch (e) {}
      this.processor = null;
    }
    if (this.audioContext) {
      try { this.audioContext.close(); } catch (e) {}
      this.audioContext = null;
    }
    if (this.mediaStream) {
      try { this.mediaStream.getTracks().forEach(t => t.stop()); } catch (e) {}
      this.mediaStream = null;
    }
    if (this.wsClient) {
      try { this.wsClient.close(); } catch (e) {}
      this.wsClient = null;
    }
    this.hideFloatingStrip();
  }

  convertFloat32ToPCM16(buffer) {
    let l = buffer.length;
    let buf = new Int16Array(l);
    while (l--) {
      let s = Math.max(-1, Math.min(1, buffer[l]));
      buf[l] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return buf.buffer;
  }

  // --------------------------------------------------------------------------
  // 功能三：Vault 内任意音频文件转写
  // --------------------------------------------------------------------------
  async transcribeVaultAudioFile(file) {
    new Notice(`⏳ Crisp ASR 正读取 ${file.name} 并发送至火山引擎...`);
    try {
      const arrayBuffer = await this.app.vault.readBinary(file);
      const ext = file.extension ? file.extension.toLowerCase() : 'webm';
      const text = await this.transcribeAudioWithFlashApi(arrayBuffer, ext);

      const noteName = file.basename + "_转写.md";
      const folder = file.parent ? file.parent.path : '';
      const targetPath = folder ? `${folder}/${noteName}` : noteName;

      const content = `# 🎙️ 音频转写: ${file.name}\n\n![[${file.path}]]\n\n> [!quote] 🎙️ Crisp ASR 语音转写\n> ${text.split('\n').join('\n> ')}\n`;
      
      const newFile = await this.app.vault.create(targetPath, content);
      this.app.workspace.getLeaf(true).openFile(newFile);
      new Notice(`✅ 转写成功！已为您打开新笔记`);
    } catch (e) {
      new Notice(`❌ 附件转写失败: ${e.message || e}`);
    }
  }

  async transcribeNoteAudioNearCursor(editor, view) {
    const line = editor.getLine(editor.getCursor().line);
    const match = line.match(/!\[\[(.*?)\]\]/) || line.match(/\[.*?\]\((.*?)\)/);
    
    if (!match) {
      new Notice('⚠️ 未在当前行找到音频嵌入引用 (如 ![[audio.m4a]])');
      return;
    }

    const audioPath = match[1];
    const file = this.app.metadataCache.getFirstLinkpathDest(audioPath, view.file.path);
    if (!file || !(file instanceof TFile)) {
      new Notice(`❌ 找不到目标音频文件: ${audioPath}`);
      return;
    }

    new Notice(`⏳ Crisp ASR 正转写音频: ${file.name}...`);
    try {
      const arrayBuffer = await this.app.vault.readBinary(file);
      const ext = file.extension ? file.extension.toLowerCase() : 'webm';
      const text = await this.transcribeAudioWithFlashApi(arrayBuffer, ext);
      
      const calloutText = `\n> [!quote] 🎙️ Crisp ASR 语音转写\n> ${text.split('\n').join('\n> ')}\n`;
      editor.replaceRange(calloutText, { line: editor.getCursor().line + 1, ch: 0 });
      new Notice(`✅ 转写成功！已写入当前笔记`);
    } catch (e) {
      new Notice(`❌ 转写失败: ${e.message || e}`);
    }
  }

  async saveAudioToVault(arrayBuffer) {
    const folderPath = this.settings.audioFolder || 'Attachments/Audio';
    await this.app.vault.createFolder(folderPath).catch(() => {});
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filePath = `${folderPath}/Crisp_Rec_${timestamp}.webm`;
    return await this.app.vault.createBinary(filePath, arrayBuffer);
  }

  insertResultToActiveEditor(audioPath, text) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view) {
      const editor = view.editor;
      const callout = `\n\n![[${audioPath}]]\n\n> [!quote] 🎙️ Crisp ASR 语音转写\n> ${text.split('\n').join('\n> ')}\n`;
      editor.replaceRange(callout, editor.getCursor());
    }
  }

  // --------------------------------------------------------------------------
  // UI 悬浮波形状态条 (Crisp Live Audio Strip)
  // --------------------------------------------------------------------------
  showFloatingStrip() {
    this.hideFloatingStrip();
    const strip = document.createElement('div');
    strip.className = 'crisp-asr-live-strip is-recording';
    
    strip.innerHTML = `
      <div class="crisp-asr-pulse-badge">
        <div class="crisp-asr-pulse-dot"></div>
        <span>课堂听写中</span>
      </div>
      <div class="crisp-asr-wave-bars">
        <div class="crisp-asr-wave-bar"></div>
        <div class="crisp-asr-wave-bar"></div>
        <div class="crisp-asr-wave-bar"></div>
        <div class="crisp-asr-wave-bar"></div>
      </div>
      <div class="crisp-asr-timer" id="crisp-asr-timer-text">00:00</div>
      <button class="crisp-asr-stop-btn" id="crisp-asr-stop-btn">完成停止</button>
    `;

    document.body.appendChild(strip);
    this.floatingStripEl = strip;

    strip.querySelector('#crisp-asr-stop-btn').onclick = () => {
      this.stopLiveStream();
    };

    this.liveStartTime = Date.now();
    this.liveTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.liveStartTime) / 1000);
      const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const secs = String(elapsed % 60).padStart(2, '0');
      const timerText = strip.querySelector('#crisp-asr-timer-text');
      if (timerText) timerText.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  hideFloatingStrip() {
    if (this.liveTimerInterval) {
      clearInterval(this.liveTimerInterval);
      this.liveTimerInterval = null;
    }
    if (this.floatingStripEl) {
      try { this.floatingStripEl.remove(); } catch (e) {}
      this.floatingStripEl = null;
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

// --------------------------------------------------------------------------
// 火山引擎豆包 ASR 官方二进制 WebSocket 协议构建类
// --------------------------------------------------------------------------
class VolcAsrWebSocketClient {
  constructor(settings, onMessage, onError) {
    this.settings = settings;
    this.onMessage = onMessage;
    this.onError = onError;
    this.ws = null;
    this.fullText = '';
    this.sequenceId = 1;
  }

  buildFrame(messageType, flags, serialization, sequenceId, payloadArrayBuffer) {
    const payloadSize = payloadArrayBuffer ? payloadArrayBuffer.byteLength : 0;
    const frame = new Uint8Array(12 + payloadSize);

    frame[0] = 0x11;
    frame[1] = ((messageType & 0x0F) << 4) | (flags & 0x0F);
    frame[2] = ((serialization & 0x0F) << 4) | 0x00;
    frame[3] = 0x00;

    const view = new DataView(frame.buffer);
    view.setUint32(4, sequenceId || 1, false);
    view.setUint32(8, payloadSize, false);

    if (payloadSize > 0) {
      frame.set(new Uint8Array(payloadArrayBuffer), 12);
    }

    return frame.buffer;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const appId = (this.settings.appId || '').trim();
      const tokenStr = (this.settings.accessToken || '').trim();
      const cleanToken = tokenStr.replace(/^Bearer;\s*/i, '').replace(/^Bearer\s*/i, '');
      const bearerHeader = `Bearer; ${cleanToken}`;
      const resourceId = (this.settings.resourceId || 'volc.bigasr.sauc.duration').trim();

      const wsUrl = `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel`;
      
      let WsCtor = window.WebSocket;
      let options = undefined;

      try {
        const NodeWs = require('ws');
        if (NodeWs) {
          WsCtor = NodeWs;
          options = {
            headers: {
              'Authorization': bearerHeader,
              'X-Api-App-Key': appId,
              'X-Api-Resource-Id': resourceId
            }
          };
        }
      } catch (e) {}

      try {
        this.ws = options ? new WsCtor(wsUrl, options) : new WsCtor(wsUrl);
        this.ws.binaryType = 'arraybuffer';
      } catch (e) {
        return reject(new Error('创建 WebSocket 实例失败: ' + (e.message || e)));
      }

      let hasOpened = false;

      if (this.ws.on) {
        this.ws.on('unexpected-response', (req, res) => {
          let detail = `HTTP Status ${res.statusCode}`;
          if (res.statusCode === 401) {
            detail = '鉴权失败 (401): Access Token 不正确或格式有误';
          } else if (res.statusCode === 403) {
            detail = '权限拒绝 (403): AppID 不匹配或未开通“语音识别大模型”服务';
          }
          const err = new Error(detail);
          this.onError(err);
          reject(err);
        });
      }

      this.ws.onopen = () => {
        hasOpened = true;
        this.sequenceId = 1;
        
        const jsonObj = {
          header: {
            message_type: "FullClientRequest",
            task_id: "crisp_task_" + Date.now()
          },
          app: {
            appid: appId,
            token: cleanToken,
            cluster: "volcengine_asr"
          },
          user: {
            uid: "crisp_user"
          },
          audio: {
            format: "pcm",
            rate: 16000,
            bits: 16,
            channel: 1
          },
          request: {
            model_name: this.settings.modelName || "bigmodel",
            enable_itn: true,
            result_type: "full"
          }
        };

        const jsonStr = JSON.stringify(jsonObj);
        const jsonBytes = new TextEncoder().encode(jsonStr);

        const frame = this.buildFrame(1, 0, 1, this.sequenceId++, jsonBytes.buffer);
        this.ws.send(frame);
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          let data = event.data;
          if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
            const buf = new Uint8Array(data);
            if (buf.length >= 12) {
              const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
              const payloadSize = view.getUint32(8, false);
              const payloadBytes = buf.subarray(12, 12 + payloadSize);
              const jsonStr = new TextDecoder().decode(payloadBytes);
              const res = JSON.parse(jsonStr);
              if (res.result && res.result.text) {
                const isFinal = res.header && res.header.message_type === "FinalResult";
                this.fullText = res.result.text;
                this.onMessage(this.fullText, isFinal);
              }
            }
          }
        } catch (e) {
          console.error("Crisp ASR 二进制响应解析错误:", e);
        }
      };

      this.ws.onerror = (err) => {
        if (!hasOpened) {
          let errMsg = 'WebSocket 握手错误';
          if (err && err.message) errMsg = err.message;
          const errorObj = new Error(errMsg);
          this.onError(errorObj);
          reject(errorObj);
        }
      };

      this.ws.onclose = (event) => {
        if (!hasOpened && event && event.code) {
          reject(new Error(`连接关闭 (Code ${event.code}): ${event.reason || '请检查凭证'}`));
        }
      };
    });
  }

  sendAudio(pcmBuffer) {
    if (this.ws && this.ws.readyState === (this.ws.OPEN || 1)) {
      const frame = this.buildFrame(2, 0, 0, this.sequenceId++, pcmBuffer);
      this.ws.send(frame);
    }
  }

  finish() {
    if (this.ws && this.ws.readyState === (this.ws.OPEN || 1)) {
      const frame = this.buildFrame(2, 2, 0, this.sequenceId++, new ArrayBuffer(0));
      this.ws.send(frame);
    }
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
  }
}

// --------------------------------------------------------------------------
// Crisp 风格 SettingTab
// --------------------------------------------------------------------------
class CrispAsrSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: '✨ Crisp ASR (豆包语音识别) 设置' });

    // 1. 卡片一：火山引擎凭证配置
    const volcCard = containerEl.createDiv({ cls: 'crisp-asr-setting-card' });
    const volcHeader = volcCard.createDiv({ cls: 'crisp-asr-setting-card__header' });
    volcHeader.innerHTML = `<span>🌋 火山引擎 (豆包) API 鉴权信息</span><span class="crisp-asr-badge is-volc">核心配置</span>`;
    
    const volcBody = volcCard.createDiv({ cls: 'crisp-asr-setting-card__body' });

    new Setting(volcBody)
      .setName('1. Access Token / API Key')
      .setDesc('火山引擎控制台中生成的 Token 凭证（核心鉴权，必填）')
      .addText(text => text
        .setPlaceholder('粘贴你的 Access Token')
        .setValue(this.plugin.settings.accessToken)
        .onChange(async (value) => {
          this.plugin.settings.accessToken = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(volcBody)
      .setName('2. Resource ID (资源 ID)')
      .setDesc('语音识别大模型极速资源 ID（默认预填：volc.bigasr.sauc.duration）')
      .addText(text => text
        .setValue(this.plugin.settings.resourceId || 'volc.bigasr.sauc.duration')
        .onChange(async (value) => {
          this.plugin.settings.resourceId = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(volcBody)
      .setName('3. Model Name (模型名称)')
      .setDesc('识别模型名称（默认预填：bigmodel）')
      .addText(text => text
        .setValue(this.plugin.settings.modelName || 'bigmodel')
        .onChange(async (value) => {
          this.plugin.settings.modelName = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(volcBody)
      .setName('测试服务连接')
      .setDesc('调用 Flash 极速接口测试 Access Token 是否有效')
      .addButton(btn => btn
        .setButtonText('测试连接')
        .setCta()
        .onClick(async () => {
          await this.plugin.testVolcConnection();
        }));

    // 2. 卡片二：存储与工作流设置
    const storageCard = containerEl.createDiv({ cls: 'crisp-asr-setting-card' });
    const storageHeader = storageCard.createDiv({ cls: 'crisp-asr-setting-card__header' });
    storageHeader.innerHTML = `<span>📁 录音存储与工作流</span><span class="crisp-asr-badge is-success">系统规范</span>`;

    const storageBody = storageCard.createDiv({ cls: 'crisp-asr-setting-card__body' });

    new Setting(storageBody)
      .setName('录音文件存储路径')
      .setDesc('自动保存录音文件的 Vault 目录路径')
      .addText(text => text
        .setPlaceholder('Attachments/Audio')
        .setValue(this.plugin.settings.audioFolder)
        .onChange(async (value) => {
          this.plugin.settings.audioFolder = value.trim();
          await this.plugin.saveSettings();
        }));
  }
}

module.exports = CrispAsrPlugin;
