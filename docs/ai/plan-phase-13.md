# Phase 13 方案：自动上下文压缩（完备）

## 目标

在现有「按消息条数 + 规则摘要」的 session 压缩基础上，做到**完备**：按 token 估算触发压缩、可选 LLM 摘要、与 Memory 结合（压缩前将关键信息写入 MEMORY.md），并保持 API 与护栏行为稳定。符合 [09-cli-advanced-roadmap.md](09-cli-advanced-roadmap.md) § Phase 13 与 [phase-implementation-sop.md](phase-implementation-sop.md)。

## 实现要点摘要

- **Token 估算**：新增 `agent/token-estimate.ts`，`estimateTokens(messages)` 采用保守近似（约 4 字符/token）；每轮在 loop 中调用，结果写入 diagnostics 与 `--verbose`。
- **Policy**：增加 `contextMaxTokens`、`compressStrategy`（message_count | token_based）、`useLlmSummary`、`compressWriteMemory`、`llmSummaryTimeoutMs`、`llmSummaryMaxInputChars`；配置与 CLI 可覆盖。
- **触发策略**：`compressStrategy === "token_based"` 且 `estimatedTokens > contextMaxTokens` 时按 token 触发；否则按 `message_count` 与 `summaryThreshold` 触发。
- **Session**：`compressToSummary` 改为 async，支持可选 `getSummary(removed)` 回调；失败时回退规则摘要；抽出 `ruleSummary(removed)` 供 loop 与 onBeforeCompress 使用。
- **LLM 摘要**：当 `useLlmSummary` 为 true 时，loop 构造 getSummary 回调，用 provider.complete 请求摘要、超时与限长，失败则回退规则摘要。
- **Memory 结合**：当 `compressWriteMemory` 为 true 时，压缩前调用 `onBeforeCompress(removed, ruleSummary(removed))`，由 index 写入 `appendToMemoryMd`。
- **可观测性**：TurnDiagnostic 增加 `estimatedTokens`；LoopResult 增加 `contextCompressEvents`；TranscriptPayload 增加 `contextCompressEvents`；verbose 输出 token 估算与压缩事件。

## 验收标准（DoD）

- 当消息条数或估算 token 超过阈值时，自动触发压缩，对话可继续且不出现 2013 等协议错误。
- 若开启 LLM 摘要，压缩后上下文明显变短且语义可被模型延续；若 LLM 摘要失败或超时，自动回退到规则摘要。
- 若开启 compressWriteMemory，压缩前将规则摘要写入当前项目 Auto Memory（MEMORY.md），下次会话可通过现有 Memory 注入看到。
- `--verbose` 或 transcript 中可见 token 估算与压缩触发记录（estimatedTokens、strategy、memoryWritten）。
- `pnpm -r build`、`pnpm -r typecheck` 通过；未配置新项时行为与当前一致（仅 message_count + 规则摘要）；既有 Phase 典型命令无回归。

详细运行与验证见 [13-phase13-runbook.md](13-phase13-runbook.md)。
