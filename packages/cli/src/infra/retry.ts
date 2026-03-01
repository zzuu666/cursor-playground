export interface RetryOptions {
  maxRetries: number;
  retryDelayMs: number;
  isRetriable?: (err: unknown) => boolean;
}

const DEFAULT_IS_RETRIABLE = (err: unknown): boolean => {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status?: number }).status;
    if (status === 429) return true;
    if (typeof status === "number" && status >= 500) return true;
  }
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    if (
      code === "ECONNRESET" ||
      code === "ETIMEDOUT" ||
      code === "ENOTFOUND" ||
      code === "ECONNREFUSED" ||
      code === "EAI_AGAIN"
    ) {
      return true;
    }
  }
  return false;
};

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const {
    maxRetries,
    retryDelayMs,
    isRetriable = DEFAULT_IS_RETRIABLE,
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries || !isRetriable(err)) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
    }
  }
  throw lastError;
}
