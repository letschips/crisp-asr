const AUDIO_EXTENSIONS = new Set([
  "aac",
  "flac",
  "m4a",
  "mp3",
  "mp4",
  "mpeg",
  "oga",
  "ogg",
  "opus",
  "wav",
  "webm",
]);

const DOUBAO_FLASH_EXTENSIONS = new Set(["mp3", "ogg", "wav"]);

function extensionOf(path: string): string {
  const parts = path.split("/");
  const name = parts[parts.length - 1] ?? "";
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isAudioPath(path: string): boolean {
  return AUDIO_EXTENSIONS.has(extensionOf(path));
}

export function needsTranscoding(path: string): boolean {
  return !DOUBAO_FLASH_EXTENSIONS.has(extensionOf(path));
}

export function mixAudioChannels(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) {
    return new Float32Array();
  }
  const length = Math.min(...channels.map((channel) => channel.length));
  const output = new Float32Array(length);
  for (const channel of channels) {
    for (let index = 0; index < length; index += 1) {
      output[index] += channel[index] / channels.length;
    }
  }
  return output;
}

export function resampleMonoLinear(
  samples: Float32Array,
  sourceRate: number,
  targetRate: number,
): Float32Array {
  if (
    samples.length === 0
    || !Number.isFinite(sourceRate)
    || !Number.isFinite(targetRate)
    || sourceRate <= 0
    || targetRate <= 0
  ) {
    return new Float32Array();
  }
  if (sourceRate === targetRate) {
    return samples.slice();
  }
  const outputLength = Math.max(
    1,
    Math.floor(samples.length * targetRate / sourceRate),
  );
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * ratio;
    const left = Math.floor(sourcePosition);
    const right = Math.min(left + 1, samples.length - 1);
    const mix = sourcePosition - left;
    output[index] = samples[left] * (1 - mix) + samples[right] * mix;
  }
  return output;
}

export function encodePcm16Wav(
  samples: Float32Array,
  sampleRate: number,
): ArrayBuffer {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeText = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataSize, true);

  for (let index = 0; index < samples.length; index += 1) {
    const clipped = Math.max(-1, Math.min(1, samples[index]));
    const pcm = clipped < 0
      ? Math.round(clipped * 32_768)
      : Math.round(clipped * 32_767);
    view.setInt16(44 + index * bytesPerSample, pcm, true);
  }
  return buffer;
}

export function float32ToPcm16Bytes(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const clipped = Math.max(-1, Math.min(1, samples[index]));
    const pcm = clipped < 0
      ? Math.round(clipped * 32_768)
      : Math.round(clipped * 32_767);
    view.setInt16(index * 2, pcm, true);
  }
  return bytes;
}

export async function decodeAudioToPcmWav(
  input: ArrayBuffer,
  ownerWindow: Window & typeof globalThis,
): Promise<ArrayBuffer> {
  const AudioContextConstructor = ownerWindow.AudioContext;
  if (!AudioContextConstructor) {
    throw new Error("当前窗口不支持音频解码");
  }
  const context = new AudioContextConstructor();
  try {
    const decoded = await context.decodeAudioData(input.slice(0));
    const channels = Array.from(
      { length: decoded.numberOfChannels },
      (_, index) => decoded.getChannelData(index),
    );
    const mono = mixAudioChannels(channels);
    const resampled = resampleMonoLinear(mono, decoded.sampleRate, 16_000);
    return encodePcm16Wav(resampled, 16_000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`无法解码该音频：${message}`);
  } finally {
    await context.close().catch(() => undefined);
  }
}
