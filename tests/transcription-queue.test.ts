import { describe, expect, it } from "vitest";
import type { PersistedFileJob } from "../src/settings";

function job(
  id: string,
  status: PersistedFileJob["status"],
  overrides: Partial<PersistedFileJob> = {},
): PersistedFileJob {
  return {
    id,
    sourcePath: `Audio/${id}.m4a`,
    status,
    attempt: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function retryable(message: string): Error {
  return Object.assign(new Error(message), { retryable: true });
}

describe("persistent transcription queue", () => {
  it("runs queued files serially", async () => {
    const { TranscriptionQueue } = await import(
      "../src/transcription-queue"
    );
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    const queue = new TranscriptionQueue([], {
      run: async (current) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        order.push(current.id);
        await Promise.resolve();
        active -= 1;
        return { outputPath: `Crisp ASR/${current.id}.md` };
      },
      persist: async () => undefined,
      now: () => 100,
      delay: async () => undefined,
      createId: (sourcePath) => sourcePath,
    });

    await queue.enqueue("Audio/a.m4a");
    await queue.enqueue("Audio/b.m4a");
    await queue.start();
    await queue.whenIdle();

    expect(maxActive).toBe(1);
    expect(order).toEqual(["Audio/a.m4a", "Audio/b.m4a"]);
    expect(queue.jobs().map((entry) => entry.status)).toEqual([
      "completed",
      "completed",
    ]);
  });

  it("allows two automatic retries and succeeds on the third attempt", async () => {
    const { TranscriptionQueue } = await import(
      "../src/transcription-queue"
    );
    let attempts = 0;
    const persistedStatuses: string[] = [];
    const queue = new TranscriptionQueue([], {
      run: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw retryable("temporary network failure");
        }
        return { outputPath: "Crisp ASR/result.md" };
      },
      persist: async (jobs) => {
        persistedStatuses.push(jobs[0]?.status ?? "none");
      },
      now: () => 1_000 + attempts,
      delay: async () => undefined,
      createId: () => "job-1",
    });

    await queue.enqueue("Audio/retry.m4a");
    await queue.start();
    await queue.whenIdle();

    expect(attempts).toBe(3);
    expect(queue.jobs()[0]).toMatchObject({
      status: "completed",
      attempt: 3,
      outputPath: "Crisp ASR/result.md",
    });
    expect(persistedStatuses).toContain("retry-wait");
  });

  it("does not retry permanent failures", async () => {
    const { TranscriptionQueue } = await import(
      "../src/transcription-queue"
    );
    let attempts = 0;
    const queue = new TranscriptionQueue([], {
      run: async () => {
        attempts += 1;
        throw Object.assign(new Error("invalid key"), { retryable: false });
      },
      persist: async () => undefined,
      now: () => 100,
      delay: async () => undefined,
      createId: () => "job-1",
    });

    await queue.enqueue("Audio/auth.m4a");
    await queue.start();
    await queue.whenIdle();

    expect(attempts).toBe(1);
    expect(queue.jobs()[0]).toMatchObject({
      status: "failed",
      attempt: 1,
      lastError: "invalid key",
    });
  });

  it("recovers interrupted and retry-wait jobs as queued", async () => {
    const { recoverInterruptedJobs } = await import(
      "../src/transcription-queue"
    );
    const recovered = recoverInterruptedJobs([
      job("a", "preparing"),
      job("b", "transcribing"),
      job("c", "retry-wait", { nextAttemptAt: 500 }),
      job("d", "completed"),
      job("e", "failed"),
    ], 1_000);

    expect(recovered.map((entry) => entry.status)).toEqual([
      "queued",
      "queued",
      "queued",
      "completed",
      "failed",
    ]);
    expect(recovered[2].nextAttemptAt).toBeUndefined();
    expect(recovered[0].updatedAt).toBe(1_000);
  });

  it("prevents duplicate non-terminal source jobs", async () => {
    const { TranscriptionQueue } = await import(
      "../src/transcription-queue"
    );
    const queue = new TranscriptionQueue([
      job("one", "queued", { sourcePath: "Audio/same.m4a" }),
    ], {
      run: async () => ({}),
      persist: async () => undefined,
      now: () => 100,
      delay: async () => undefined,
      createId: () => "job-2",
    });

    await expect(queue.enqueue("Audio/same.m4a")).resolves.toBeNull();
    expect(queue.jobs()).toHaveLength(1);
  });

  it("manually retries failed jobs with a fresh retry budget", async () => {
    const { TranscriptionQueue } = await import(
      "../src/transcription-queue"
    );
    const queue = new TranscriptionQueue([
      job("failed", "failed", {
        attempt: 3,
        lastError: "offline",
      }),
    ], {
      run: async () => ({ outputPath: "Crisp ASR/recovered.md" }),
      persist: async () => undefined,
      now: () => 100,
      delay: async () => undefined,
      createId: () => "unused",
    });

    await expect(queue.retry("failed")).resolves.toBe(true);
    await queue.start();
    await queue.whenIdle();

    expect(queue.jobs()[0]).toMatchObject({
      status: "completed",
      attempt: 1,
      outputPath: "Crisp ASR/recovered.md",
    });
    expect(queue.jobs()[0].lastError).toBeUndefined();
  });

  it("removes terminal jobs but preserves active work", async () => {
    const { TranscriptionQueue } = await import(
      "../src/transcription-queue"
    );
    const queue = new TranscriptionQueue([
      job("done", "completed"),
      job("active", "queued"),
    ], {
      run: async () => ({}),
      persist: async () => undefined,
      now: () => 100,
      delay: async () => undefined,
      createId: () => "unused",
    });

    await expect(queue.remove("active")).resolves.toBe(false);
    await expect(queue.remove("done")).resolves.toBe(true);
    expect(queue.jobs().map((entry) => entry.id)).toEqual(["active"]);
  });

  it("keeps the newest 100 jobs plus every failed or active job", async () => {
    const { pruneFileJobs } = await import("../src/transcription-queue");
    const completed = Array.from({ length: 110 }, (_, index) =>
      job(`done-${index}`, "completed", { updatedAt: index })
    );
    const protectedJobs = [
      job("failed-old", "failed", { updatedAt: -2 }),
      job("queued-old", "queued", { updatedAt: -1 }),
    ];

    const pruned = pruneFileJobs([...completed, ...protectedJobs]);

    expect(pruned).toHaveLength(102);
    expect(pruned.some((entry) => entry.id === "done-0")).toBe(false);
    expect(pruned.some((entry) => entry.id === "done-109")).toBe(true);
    expect(pruned.some((entry) => entry.id === "failed-old")).toBe(true);
    expect(pruned.some((entry) => entry.id === "queued-old")).toBe(true);
  });
});
