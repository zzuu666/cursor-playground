export interface LoopPolicy {
  maxTurns: number;
  maxToolCalls: number;
  toolTimeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  maxSameToolRepeat: number;
  summaryThreshold: number;
  summaryKeepRecent: number;
}

export const DEFAULT_LOOP_POLICY: LoopPolicy = {
  maxTurns: 12,
  maxToolCalls: 20,
  toolTimeoutMs: 15_000,
  maxRetries: 3,
  retryDelayMs: 1000,
  maxSameToolRepeat: 3,
  summaryThreshold: 16,
  summaryKeepRecent: 8,
};
