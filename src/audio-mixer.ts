import {
  float32ToPcm16Bytes,
  resampleMonoLinear,
} from "./audio";

const TARGET_SAMPLE_RATE = 16_000;
const PACKET_SAMPLES = 3_200;
const LEVEL_INTERVAL_MS = 100;

export function calculateRmsLevel(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }
  let squareSum = 0;
  for (const sample of samples) {
    const finite = Number.isFinite(sample) ? sample : 0;
    const clipped = Math.max(-1, Math.min(1, finite));
    squareSum += clipped * clipped;
  }
  return Math.min(1, Math.sqrt(squareSum / samples.length));
}

export function smoothInputLevel(previous: number, next: number): number {
  const boundedPrevious = Math.max(0, Math.min(1, previous));
  const boundedNext = Math.max(0, Math.min(1, next));
  const response = boundedNext >= boundedPrevious ? 0.65 : 0.22;
  return boundedPrevious + (boundedNext - boundedPrevious) * response;
}

export class PcmPacketizer {
  private pending: number[] = [];

  push(samples: Float32Array, sourceRate: number): Uint8Array[] {
    const resampled = resampleMonoLinear(
      samples,
      sourceRate,
      TARGET_SAMPLE_RATE,
    );
    this.pending.push(...resampled);
    const packets: Uint8Array[] = [];
    while (this.pending.length >= PACKET_SAMPLES) {
      packets.push(float32ToPcm16Bytes(
        new Float32Array(this.pending.splice(0, PACKET_SAMPLES)),
      ));
    }
    return packets;
  }

  flush(): Uint8Array | null {
    if (this.pending.length === 0) {
      return null;
    }
    const final = float32ToPcm16Bytes(new Float32Array(this.pending));
    this.pending = [];
    return final;
  }
}

export interface LiveAudioMixerOptions {
  onPacket: (packet: Uint8Array) => void;
  onLevel: (level: number) => void;
}

export class LiveAudioMixer {
  private context: AudioContext | null = null;
  private sources: MediaStreamAudioSourceNode[] = [];
  private compressor: DynamicsCompressorNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private silentGain: GainNode | null = null;
  private recordingDestination: MediaStreamAudioDestinationNode | null = null;
  private readonly packetizer = new PcmPacketizer();
  private level = 0;
  private lastLevelAt = 0;
  private pcmRunning = false;

  constructor(
    private readonly ownerWindow: Window & typeof globalThis,
    private readonly options: LiveAudioMixerOptions,
  ) {}

  async start(streams: MediaStream[]): Promise<MediaStream> {
    if (this.context) {
      throw new Error("实时音频混音已经开始");
    }
    if (streams.length === 0) {
      throw new Error("没有可用于转写的音频输入");
    }
    const context = new this.ownerWindow.AudioContext();
    this.context = context;
    if (context.state === "suspended") {
      await context.resume();
    }
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 18;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;
    this.compressor = compressor;

    this.sources = streams.map((stream) => {
      const source = context.createMediaStreamSource(stream);
      source.connect(compressor);
      return source;
    });

    const processor = context.createScriptProcessor(4_096, 1, 1);
    const silentGain = context.createGain();
    const recordingDestination = context.createMediaStreamDestination();
    silentGain.gain.value = 0;
    this.processor = processor;
    this.silentGain = silentGain;
    this.recordingDestination = recordingDestination;
    this.pcmRunning = true;

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const nextLevel = calculateRmsLevel(input);
      this.level = smoothInputLevel(this.level, nextLevel);
      const now = Date.now();
      if (now - this.lastLevelAt >= LEVEL_INTERVAL_MS) {
        this.lastLevelAt = now;
        this.options.onLevel(this.level);
      }
      for (
        const packet of this.packetizer.push(
          input,
          event.inputBuffer.sampleRate,
        )
      ) {
        this.options.onPacket(packet);
      }
    };

    compressor.connect(processor);
    compressor.connect(recordingDestination);
    processor.connect(silentGain);
    silentGain.connect(context.destination);
    return recordingDestination.stream;
  }

  stopPcm(): void {
    if (!this.pcmRunning) {
      return;
    }
    this.pcmRunning = false;
    if (this.processor) {
      this.processor.onaudioprocess = null;
      this.compressor?.disconnect(this.processor);
      this.processor.disconnect();
    }
    this.silentGain?.disconnect();
    const finalPacket = this.packetizer.flush();
    if (finalPacket) {
      this.options.onPacket(finalPacket);
    }
    this.level = 0;
    this.options.onLevel(0);
  }

  async close(): Promise<void> {
    this.stopPcm();
    for (const source of this.sources) {
      source.disconnect();
    }
    this.sources = [];
    this.compressor?.disconnect();
    this.compressor = null;
    this.processor = null;
    this.silentGain = null;
    for (const track of this.recordingDestination?.stream.getTracks() ?? []) {
      track.stop();
    }
    this.recordingDestination?.disconnect();
    this.recordingDestination = null;
    if (this.context) {
      await this.context.close().catch(() => undefined);
      this.context = null;
    }
  }
}
