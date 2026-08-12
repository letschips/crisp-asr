import { describe, expect, it } from "vitest";

describe("live audio mixing primitives", () => {
  it("notifies once per configured continuous silence period and resets on sound", async () => {
    const { SilenceMonitor } = await import("../src/audio-mixer");
    let notifications = 0;
    const monitor = new SilenceMonitor(60_000, () => {
      notifications += 1;
    });

    monitor.observe(0, 1_000);
    monitor.observe(0, 60_999);
    expect(notifications).toBe(0);
    monitor.observe(0, 61_000);
    monitor.observe(0, 90_000);
    expect(notifications).toBe(1);
    monitor.observe(0.1, 91_000);
    monitor.observe(0, 92_000);
    monitor.observe(0, 152_000);
    expect(notifications).toBe(2);
  });
  it("calculates RMS input level and clamps invalid samples", async () => {
    const { calculateRmsLevel } = await import("../src/audio-mixer");

    expect(calculateRmsLevel(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
    expect(calculateRmsLevel(new Float32Array([2, -2]))).toBe(1);
    expect(calculateRmsLevel(new Float32Array())).toBe(0);
  });

  it("uses fast attack and slower release for a readable meter", async () => {
    const { smoothInputLevel } = await import("../src/audio-mixer");

    const attack = smoothInputLevel(0, 0.8);
    const release = smoothInputLevel(attack, 0);
    expect(attack).toBeGreaterThan(0.4);
    expect(release).toBeGreaterThan(0);
    expect(release).toBeLessThan(attack);
  });

  it("emits exact 3200-sample PCM16 packets", async () => {
    const { PcmPacketizer } = await import("../src/audio-mixer");
    const packetizer = new PcmPacketizer();
    const samples = new Float32Array(6_500);
    samples.fill(0.25);

    const packets = packetizer.push(samples, 16_000);

    expect(packets).toHaveLength(2);
    expect(packets[0]).toHaveLength(6_400);
    expect(packets[1]).toHaveLength(6_400);
    expect(packetizer.flush()).toHaveLength(200);
    expect(packetizer.flush()).toBeNull();
  });

  it("resamples incoming chunks before packetizing", async () => {
    const { PcmPacketizer } = await import("../src/audio-mixer");
    const packetizer = new PcmPacketizer();
    const samples = new Float32Array(9_600);
    samples.fill(0.1);

    const packets = packetizer.push(samples, 48_000);

    expect(packets).toHaveLength(1);
    expect(packets[0]).toHaveLength(6_400);
    expect(packetizer.flush()).toBeNull();
  });
});
