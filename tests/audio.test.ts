import { describe, expect, it } from "vitest";
import {
  encodePcm16Wav,
  geminiUploadMimeType,
  float32ToPcm16Bytes,
  isAudioPath,
  mixAudioChannels,
  needsTranscoding,
  resampleMonoLinear,
} from "../src/audio";

describe("audio file routing", () => {
  it.each([
    "lecture.mp3",
    "lecture.wav",
    "lecture.ogg",
    "lecture.m4a",
    "lecture.webm",
    "lecture.flac",
  ])("accepts %s as an audio file", (path) => {
    expect(isAudioPath(path)).toBe(true);
  });

  it("rejects non-audio vault files", () => {
    expect(isAudioPath("lecture.md")).toBe(false);
  });

  it("transcodes containers that the Doubao flash endpoint does not accept", () => {
    expect(needsTranscoding("recording.m4a")).toBe(true);
    expect(needsTranscoding("recording.webm")).toBe(true);
    expect(needsTranscoding("recording.mp3")).toBe(false);
    expect(needsTranscoding("recording.wav")).toBe(false);
    expect(needsTranscoding("recording.ogg")).toBe(false);
  });

  it("labels decoded audio as WAV instead of preserving the source container MIME", () => {
    expect(geminiUploadMimeType("recording.m4a", true)).toBe("audio/wav");
    expect(geminiUploadMimeType("recording.webm", true)).toBe("audio/wav");
    expect(geminiUploadMimeType("recording.mp3", false)).toBe("audio/mp3");
    expect(geminiUploadMimeType("recording.ogg", false)).toBe("audio/ogg");
  });

  it("keeps Gemini-native AAC and FLAC files compressed while transcoding unsupported containers", () => {
    expect(needsTranscoding("recording.aac", "gemini")).toBe(false);
    expect(needsTranscoding("recording.flac", "gemini")).toBe(false);
    expect(needsTranscoding("recording.m4a", "gemini")).toBe(true);
    expect(needsTranscoding("recording.webm", "gemini")).toBe(true);
  });
});

describe("PCM preparation", () => {
  it("mixes channels without clipping the average", () => {
    const mono = mixAudioChannels([
      new Float32Array([1, 0.5]),
      new Float32Array([-1, 0.5]),
    ]);
    expect([...mono]).toEqual([0, 0.5]);
  });

  it("resamples mono samples to 16 kHz", () => {
    const source = new Float32Array([0, 0.25, 0.5, 0.75, 1, 0.75]);
    const output = resampleMonoLinear(source, 48_000, 16_000);
    expect([...output]).toEqual([0, 0.75]);
  });

  it("encodes a valid mono 16-bit WAV and clips out-of-range samples", () => {
    const wav = new Uint8Array(
      encodePcm16Wav(new Float32Array([-2, 0, 2]), 16_000),
    );
    const view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(44, true)).toBe(-32_768);
    expect(view.getInt16(46, true)).toBe(0);
    expect(view.getInt16(48, true)).toBe(32_767);
  });

  it("converts live float samples to little-endian PCM16 bytes", () => {
    const bytes = float32ToPcm16Bytes(new Float32Array([-1, 0, 1]));
    const view = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
    expect(view.getInt16(0, true)).toBe(-32_768);
    expect(view.getInt16(2, true)).toBe(0);
    expect(view.getInt16(4, true)).toBe(32_767);
  });
});
