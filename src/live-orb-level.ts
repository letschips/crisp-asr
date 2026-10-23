// Maps raw RMS onto 0–1 against a learned noise floor, so a steady room reads
// as still and a quiet microphone still moves. Display only: silence detection
// keeps using the raw level.

// The floor is the quietest moment of the recent window: speech always has a
// gap somewhere, so talking does not lift it, while a room that gets louder
// for good is picked up once the window has passed.
const FLOOR_WINDOW_MS = 15_000;
const FLOOR_FALL_SECONDS = 0.3;
const FLOOR_RISE_SECONDS = 1;
const PEAK_FALL_SECONDS = 3;
const MIN_SPAN_DB = 20;
const GATE_DB = 3;
// Below any real microphone's self-noise; an OS-muted input sends near-zero
// samples that would otherwise sink the floor far under the room.
const MIN_DB = -80;

function toDb(level: number): number {
  return Math.max(MIN_DB, 20 * Math.log10(Math.min(1, level)));
}

function approach(current: number, target: number, dt: number, seconds: number): number {
  return current + (target - current) * (1 - Math.exp(-dt / seconds));
}

export class InputLevelNormalizer {
  private floor = 0;
  private peak = 0;
  private lastAt = -1;
  private readonly recent: Array<{ at: number; db: number }> = [];

  push(level: number, now: number): number {
    // Zero means no capture yet (or a reset), not a room; learning from it
    // would drop the floor to -inf and make the first real seconds read loud.
    if (!Number.isFinite(level) || level <= 0) return 0;
    const db = toDb(level);
    if (this.lastAt < 0) {
      this.floor = db;
      this.peak = db + MIN_SPAN_DB;
      this.lastAt = now;
    }
    const dt = Math.min(1, Math.max(0, (now - this.lastAt) / 1000));
    this.lastAt = now;
    this.recent.push({ at: now, db });
    while (this.recent.length > 1 && now - this.recent[0].at > FLOOR_WINDOW_MS) {
      this.recent.shift();
    }
    if (dt > 0) {
      const quietest = Math.min(...this.recent.map((sample) => sample.db));
      this.floor = approach(
        this.floor,
        quietest,
        dt,
        quietest < this.floor ? FLOOR_FALL_SECONDS : FLOOR_RISE_SECONDS,
      );
      this.peak = db > this.peak ? db : approach(this.peak, db, dt, PEAK_FALL_SECONDS);
    }
    this.peak = Math.max(this.peak, this.floor + MIN_SPAN_DB);
    const gate = this.floor + GATE_DB;
    return Math.max(0, Math.min(1, (db - gate) / (this.peak - gate)));
  }
}
