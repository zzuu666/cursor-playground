/** Phase 13: 压缩触发策略：按条数或按估算 token。 */
export type CompressStrategy = "message_count" | "token_based";

export interface LoopPolicy {
  maxTurns: number;
  maxToolCalls: number;
  toolTimeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  maxSameToolRepeat: number;
  summaryThreshold: number;
  summaryKeepRecent: number;
  /** Phase 13: 按 token 触发时的上限；0 表示不按 token 触发。 */
  contextMaxTokens: number;
  /** Phase 13: 压缩触发策略，默认 message_count。 */
  compressStrategy: CompressStrategy;
  /** Phase 13: 压缩时是否用 LLM 生成摘要（失败则回退规则摘要）。 */
  useLlmSummary: boolean;
  /** Phase 13: 压缩前是否将规则摘要写入 Auto Memory。 */
  compressWriteMemory: boolean;
  /** Phase 13: LLM 摘要请求超时（毫秒）。 */
  llmSummaryTimeoutMs: number;
  /** Phase 13: 发给 LLM 摘要的输入最大字符数。 */
  llmSummaryMaxInputChars: number;
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
  contextMaxTokens: 0,
  compressStrategy: "message_count",
  useLlmSummary: false,
  compressWriteMemory: false,
  llmSummaryTimeoutMs: 15_000,
  llmSummaryMaxInputChars: 50_000,
};
