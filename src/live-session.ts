export interface LiveSessionResources {
  capture: {
    acquire(): Promise<void>;
    start(): Promise<MediaStream>;
    stopPcm(): void;
    stop(): Promise<void>;
  };
  client: {
    connect(): Promise<void>;
    finish(): Promise<void>;
    close(): void;
  };
  recorder?: {
    start(stream: MediaStream): void;
    stop(): Promise<string>;
  };
}

export interface LiveFinishResult {
  audioPath?: string;
  recordingError?: Error;
  finishError?: Error;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function throwIfStartupCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("实时听写启动已取消");
  }
}

export async function startLiveResources(
  resources: LiveSessionResources,
  signal?: AbortSignal,
): Promise<void> {
  try {
    throwIfStartupCancelled(signal);
    await resources.capture.acquire();
    throwIfStartupCancelled(signal);
    await resources.client.connect();
    throwIfStartupCancelled(signal);
    const mixedStream = await resources.capture.start();
    throwIfStartupCancelled(signal);
    resources.recorder?.start(mixedStream);
  } catch (error) {
    await closeLiveResources(resources);
    throw error;
  }
}

export async function finishLiveResources(
  resources: LiveSessionResources,
): Promise<LiveFinishResult> {
  resources.capture.stopPcm();
  let audioPath: string | undefined;
  let recordingError: Error | undefined;
  let finishError: Error | undefined;
  if (resources.recorder) {
    try {
      audioPath = await resources.recorder.stop();
    } catch (error) {
      recordingError = asError(error);
    }
  }
  try {
    await resources.client.finish();
  } catch (error) {
    finishError = asError(error);
  }
  return {
    ...(audioPath ? { audioPath } : {}),
    ...(recordingError ? { recordingError } : {}),
    ...(finishError ? { finishError } : {}),
  };
}

export async function closeLiveResources(
  resources: Pick<LiveSessionResources, "capture" | "client">,
): Promise<void> {
  resources.client.close();
  await resources.capture.stop().catch(() => undefined);
}
