import type { PersistedFileJob } from "./settings";

const NON_TERMINAL = new Set<PersistedFileJob["status"]>([
  "queued",
  "preparing",
  "transcribing",
  "retry-wait",
]);
const RETRY_DELAYS_MS = [1_500, 5_000] as const;

export interface FileJobRunResult {
  outputPath?: string;
}

export interface TranscriptionQueueDependencies {
  run: (job: PersistedFileJob) => Promise<FileJobRunResult>;
  persist: (jobs: PersistedFileJob[]) => Promise<void>;
  now?: () => number;
  delay?: (milliseconds: number) => Promise<void>;
  createId?: (sourcePath: string) => string;
  onChange?: (jobs: PersistedFileJob[]) => void;
}

function cloneJob(job: PersistedFileJob): PersistedFileJob {
  return { ...job };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRetryable(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "retryable" in error
    && (error as { retryable?: unknown }).retryable === true,
  );
}

export function recoverInterruptedJobs(
  jobs: PersistedFileJob[],
  now: number,
): PersistedFileJob[] {
  return jobs.map((job) => {
    if (
      job.status !== "preparing"
      && job.status !== "transcribing"
      && job.status !== "retry-wait"
    ) {
      return cloneJob(job);
    }
    const recovered = cloneJob(job);
    recovered.status = "queued";
    recovered.updatedAt = now;
    delete recovered.nextAttemptAt;
    return recovered;
  });
}

export function pruneFileJobs(
  jobs: PersistedFileJob[],
): PersistedFileJob[] {
  const newest = [...jobs]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 100);
  const keepIds = new Set(newest.map((job) => job.id));
  for (const job of jobs) {
    if (job.status === "failed" || NON_TERMINAL.has(job.status)) {
      keepIds.add(job.id);
    }
  }
  return jobs.filter((job) => keepIds.has(job.id));
}

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export class TranscriptionQueue {
  private storedJobs: PersistedFileJob[];
  private started = false;
  private recovered = false;
  private drainPromise: Promise<void> | null = null;

  constructor(
    initialJobs: PersistedFileJob[],
    private readonly dependencies: TranscriptionQueueDependencies,
  ) {
    this.storedJobs = initialJobs.map(cloneJob);
  }

  jobs(): PersistedFileJob[] {
    return this.storedJobs.map(cloneJob);
  }

  async enqueue(
    sourcePath: string,
    targetPath?: string,
  ): Promise<PersistedFileJob | null> {
    if (this.storedJobs.some((job) =>
      job.sourcePath === sourcePath && NON_TERMINAL.has(job.status)
    )) {
      return null;
    }
    const now = this.now();
    const entry: PersistedFileJob = {
      id: this.dependencies.createId?.(sourcePath)
        ?? `${now}-${Math.random().toString(36).slice(2, 10)}`,
      sourcePath,
      ...(targetPath ? { targetPath } : {}),
      status: "queued",
      attempt: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.storedJobs.push(entry);
    await this.commit();
    this.kick();
    return cloneJob(entry);
  }

  async start(): Promise<void> {
    this.started = true;
    if (!this.recovered) {
      this.recovered = true;
      const before = JSON.stringify(this.storedJobs);
      this.storedJobs = recoverInterruptedJobs(this.storedJobs, this.now());
      if (JSON.stringify(this.storedJobs) !== before) {
        await this.commit();
      }
    }
    this.kick();
  }

  stop(): void {
    this.started = false;
  }

  async whenIdle(): Promise<void> {
    this.kick();
    while (this.drainPromise) {
      await this.drainPromise;
    }
  }

  async retry(id: string): Promise<boolean> {
    const entry = this.storedJobs.find((job) => job.id === id);
    if (!entry || entry.status !== "failed") {
      return false;
    }
    entry.status = "queued";
    entry.attempt = 0;
    entry.updatedAt = this.now();
    delete entry.nextAttemptAt;
    delete entry.lastError;
    delete entry.outputPath;
    await this.commit();
    this.kick();
    return true;
  }

  async remove(id: string): Promise<boolean> {
    const entry = this.storedJobs.find((job) => job.id === id);
    if (
      !entry
      || (entry.status !== "completed" && entry.status !== "failed")
    ) {
      return false;
    }
    this.storedJobs = this.storedJobs.filter((job) => job.id !== id);
    await this.commit();
    return true;
  }

  private now(): number {
    return this.dependencies.now?.() ?? Date.now();
  }

  private kick(): void {
    if (!this.started || this.drainPromise) {
      return;
    }
    if (!this.storedJobs.some((job) => job.status === "queued")) {
      return;
    }
    this.drainPromise = this.drain().finally(() => {
      this.drainPromise = null;
      this.kick();
    });
  }

  private async drain(): Promise<void> {
    while (this.started) {
      const entry = this.storedJobs.find((job) => job.status === "queued");
      if (!entry) {
        return;
      }
      entry.status = "preparing";
      entry.attempt += 1;
      entry.updatedAt = this.now();
      delete entry.nextAttemptAt;
      await this.commit();

      entry.status = "transcribing";
      entry.updatedAt = this.now();
      await this.commit();
      try {
        const result = await this.dependencies.run(cloneJob(entry));
        entry.status = "completed";
        entry.updatedAt = this.now();
        delete entry.lastError;
        delete entry.nextAttemptAt;
        if (result.outputPath) {
          entry.outputPath = result.outputPath;
        } else {
          delete entry.outputPath;
        }
        await this.commit();
      } catch (error) {
        entry.lastError = errorMessage(error);
        entry.updatedAt = this.now();
        if (isRetryable(error) && entry.attempt < 3) {
          const delayMs = RETRY_DELAYS_MS[entry.attempt - 1]
            ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
          entry.status = "retry-wait";
          entry.nextAttemptAt = this.now() + delayMs;
          await this.commit();
          await (this.dependencies.delay ?? defaultDelay)(delayMs);
          if (!this.started) {
            return;
          }
          entry.status = "queued";
          entry.updatedAt = this.now();
          delete entry.nextAttemptAt;
          await this.commit();
        } else {
          entry.status = "failed";
          delete entry.nextAttemptAt;
          await this.commit();
        }
      }
    }
  }

  private async commit(): Promise<void> {
    this.storedJobs = pruneFileJobs(this.storedJobs);
    const snapshot = this.jobs();
    await this.dependencies.persist(snapshot);
    this.dependencies.onChange?.(snapshot);
  }
}
