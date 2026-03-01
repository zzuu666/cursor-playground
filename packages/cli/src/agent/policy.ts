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
  maxTurns: 20,
  maxToolCalls: 40,
  toolTimeoutMs: 15_000,
  maxRetries: 3,
  retryDelayMs: 1000,
  maxSameToolRepeat: 3,
  summaryThreshold: 16,
  summaryKeepRecent: 8,
};
