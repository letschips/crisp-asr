export interface LiveResources {
  client: {
    close(): void;
  };
  capture: {
    stop(): Promise<void>;
  };
}

export async function abortLiveResources(
  resources: LiveResources,
): Promise<void> {
  resources.client.close();
  await resources.capture.stop().catch(() => undefined);
}
