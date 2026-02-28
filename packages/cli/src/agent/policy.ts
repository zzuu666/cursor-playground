export interface LoopPolicy {
  maxTurns: number;
  maxToolCalls: number;
  toolTimeoutMs: number;
}

export const DEFAULT_LOOP_POLICY: LoopPolicy = {
  maxTurns: 12,
  maxToolCalls: 20,
  toolTimeoutMs: 15_000,
};
