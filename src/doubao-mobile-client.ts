import { pcm16PacketsToWav } from "./audio";
import { transcribeFlash } from "./doubao-service";
import type { RecognitionEnhancement } from "./recognition-context";

export interface DoubaoMobileRecorderClientOptions {
  apiKey: string;
  recognition?: RecognitionEnhancement;
  onPayload: (payload: unknown) => void;
  onError: (error: Error) => void;
  onLogId?: (logId: string) => void;
}

export class DoubaoMobileRecorderClient {
  private packets: Uint8Array[] = [];
  private closed = false;

  constructor(private readonly options: DoubaoMobileRecorderClientOptions) {}

  async connect(): Promise<void> {
    const key = this.options.apiKey.trim();
    if (!key) {
      throw new Error("豆包 API Key 不能为空");
    }
    this.packets = [];
    this.closed = false;
  }

  sendAudio(packet: Uint8Array): void {
    if (this.closed) return;
    this.packets.push(packet);
  }

  async finish(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.packets.length === 0) {
      throw new Error("未采集到音频数据（麦克风可能被系统静音，请检查设备后重试）");
    }

    const totalLength = this.packets.reduce(
      (sum, p) => sum + p.byteLength,
      0,
    );
    // 16kHz 16-bit Mono 每秒 32,000 字节，若少于 0.3 秒（9,600 字节）视为主观误触或过短
    if (totalLength < 9_600) {
      throw new Error("录音时间太短（不足 0.3 秒），请多说两句");
    }

    const wavBuffer = pcm16PacketsToWav(this.packets);
    try {
      const response = await transcribeFlash(
        this.options.apiKey,
        wavBuffer,
        this.options.recognition,
      );
      if (response.logId && this.options.onLogId) {
        this.options.onLogId(response.logId);
      }
      this.options.onPayload({
        result: {
          text: response.text,
          utterances: response.utterances,
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (
        msg.includes("20000003")
        || msg.toLowerCase().includes("no speech")
        || msg.toLowerCase().includes("empty audio")
      ) {
        const seconds = (totalLength / 32_000).toFixed(1);
        throw new Error(`未检测到清晰语音（已录音 ${seconds} 秒，请靠近麦克风大声说话）`);
      }
      throw error;
    }
  }

  close(): void {
    this.closed = true;
    this.packets = [];
  }
}
