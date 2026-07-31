export class AsrServiceError extends Error {
  readonly retryable: boolean;
  readonly code?: string;
  readonly cause?: unknown;

  constructor(
    message: string,
    retryable: boolean,
    options: { code?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "AsrServiceError";
    this.retryable = retryable;
    this.code = options.code;
    this.cause = options.cause;
  }
}

export function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500 || status <= 0;
}

export function isRetryableServiceCode(code: string): boolean {
  return /^55\d{6}$/.test(code);
}

export function toAsrServiceError(
  error: unknown,
  retryable: boolean,
): AsrServiceError {
  if (
    error instanceof AsrServiceError
    || (
      error instanceof Error
      && "retryable" in error
      && typeof (error as Error & { retryable?: unknown }).retryable
        === "boolean"
    )
  ) {
    return error as AsrServiceError;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new AsrServiceError(message, retryable, { cause: error });
}
