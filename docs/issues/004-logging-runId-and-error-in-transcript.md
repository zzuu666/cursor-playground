# Issue 004：日志系统完善 — runId 与 transcript 错误记录

## 背景

实践中发现日志与 transcript 存在不足：

- 没有唯一 run 标识，多 run 或重定向日志时难以关联某次运行的 stderr 与 transcript。
- 因护栏/业务错误终止时，transcript 只写了 `meta.spinDetected`（空转场景），未统一记录错误类型与信息（如 maxTurns、maxToolCalls），不便于审计与排查。

## 实现

### 1. runId

- **生成**：每次 run 开始时调用 `createRunId()`，得到唯一 ID（`timestamp(36)-random(8)`），例如 `m5abc123-def45678`。
- **Transcript**：`TranscriptPayload` 增加必填字段 `runId`，写入每条 transcript JSON。
- **stderr**：run 期间通过 `setRunId(runId)` 设置上下文，`logToolCall`、`logTurnDiagnostics`、`logStreamTurn` 在每行前加 `[runId] ` 前缀；run 结束在 `finally` 中 `clearRunId()`。
- **结束输出**：成功或错误时均输出 `runId=xxx` 与 `transcript=<path>`，便于用 runId 查对应 transcript。

### 2. 错误记录到 transcript

- **TranscriptMeta** 增加可选字段 `error?: { name: string; message: string }`。
- 在捕获 `LoopLimitError`、`LoopSpinDetectedError` 并写入 transcript 时，统一设置 `meta.error = { name: err.name, message: err.message }`；若为 `LoopSpinDetectedError` 则同时保留 `meta.spinDetected: true`。

### 3. 涉及文件

- `packages/cli/src/infra/logger.ts`：`createRunId`、`setRunId`、`clearRunId`、`logPrefix()`、`TranscriptError`、`TranscriptPayload.runId`、`TranscriptMeta.error`，以及各 log 函数带前缀。
- `packages/cli/src/index.ts`：单次 prompt 与 REPL 路径中生成 runId、setRunId/clearRunId、所有 `writeTranscript` 传入 `runId`，错误分支传入 `meta.error`。

### 4. 文档

- **Phase 4 Runbook**：新增「日志系统与 runId」「Transcript 变更」小节，DoD 增加 runId 与 meta.error 验收。
- **Phase 6 Runbook**：安全与审计、运行时日志、验收中补充 runId 与 meta.error 说明。

## 验收

- 单次 run 的 stderr 中 `[tool]`、`[turn N]` 等行带相同 `[runId]` 前缀；结束输出含 `runId=xxx`。
- 每条 transcript JSON 含 `runId`，且与当次 run 的 stderr 中 runId 一致。
- 人为触发 maxTurns 或 maxToolCalls 触顶（或空转），transcript 的 `meta` 中含 `error: { name, message }`，便于排查。
