import { describe, expect, it } from "vitest";
import { InputLevelNormalizer } from "../src/live-orb-level";

const STEP_MS = 100;

function feed(
  normalizer: InputLevelNormalizer,
  start: number,
  seconds: number,
  level: (i: number) => number,
): { last: number; max: number; end: number } {
  let now = start;
  let last = 0;
  let max = 0;
  const steps = Math.round((seconds * 1000) / STEP_MS);
  for (let i = 0; i < steps; i += 1) {
    now += STEP_MS;
    last = normalizer.push(level(i), now);
    max = Math.max(max, last);
  }
  return { last, max, end: now };
}

describe("orb input level normalizer", () => {
  it("settles a steady noisy room to near zero", () => {
    const normalizer = new InputLevelNormalizer();
    const room = feed(normalizer, 0, 12, (i) => 0.15 + (i % 3) * 0.01);
    expect(room.last).toBeLessThan(0.12);
  });

  it("still moves clearly when someone talks over that room noise", () => {
    const normalizer = new InputLevelNormalizer();
    const room = feed(normalizer, 0, 12, () => 0.02);
    const speech = feed(normalizer, room.end, 2, (i) => (i % 4 === 0 ? 0.04 : 0.15));
    expect(speech.max).toBeGreaterThan(0.6);
  });

  it("keeps moving through a long stretch of continuous speech", () => {
    const normalizer = new InputLevelNormalizer();
    const room = feed(normalizer, 0, 5, () => 0.002);
    // Like a lecture: 100 ms windows rarely dip below a third of speech level.
    const lecture = (i: number) => (i % 10 === 9 ? 0.013 : 0.03 + (i % 3) * 0.005);
    const speech = feed(normalizer, room.end, 12, lecture);
    const tail = feed(normalizer, speech.end, 2, lecture);
    expect(tail.max).toBeGreaterThan(0.5);
  });

  it("adapts when the room gets louder for good", () => {
    const normalizer = new InputLevelNormalizer();
    const quiet = feed(normalizer, 0, 5, () => 0.002);
    const louder = feed(normalizer, quiet.end, 25, () => 0.02);
    expect(louder.last).toBeLessThan(0.12);
  });

  it("lifts a quiet microphone that never exceeds a few percent", () => {
    const normalizer = new InputLevelNormalizer();
    const quiet = feed(normalizer, 0, 8, () => 0.001);
    const speech = feed(normalizer, quiet.end, 2, (i) => (i % 4 === 0 ? 0.003 : 0.012));
    expect(speech.max).toBeGreaterThan(0.6);
  });

  it("does not amplify tiny jitter in a silent room", () => {
    const normalizer = new InputLevelNormalizer();
    const silent = feed(normalizer, 0, 12, (i) => (i % 2 ? 0.0012 : 0.0018));
    expect(silent.max).toBeLessThan(0.15);
  });

  it("does not learn the floor from zeros sent before capture starts", () => {
    const normalizer = new InputLevelNormalizer();
    const startup = feed(normalizer, 0, 3, () => 0);
    const room = feed(normalizer, startup.end, 1, () => 0.02);
    expect(room.last).toBeLessThan(0.12);
  });

  it("treats zero and invalid input as silence", () => {
    const normalizer = new InputLevelNormalizer();
    expect(normalizer.push(0, 100)).toBe(0);
    expect(normalizer.push(Number.NaN, 200)).toBe(0);
  });
});
