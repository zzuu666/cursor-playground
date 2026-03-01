# Issue 005：Session UUID 与独立 Error 日志

## 背景

在 [004-logging-runId-and-error-in-transcript.md](004-logging-runId-and-error-in-transcript.md) 中我们引入了 runId 与 transcript 内 meta.error。为进一步改善可关联性与运维体验，采纳「session 创建时生成唯一 UUID、transcript 与 error 独立记录」方案。

## 变更概要

1. **runId → sessionId（Session 级 UUID）**
   - 在创建 `AgentSession` 时生成一次 `sessionId = crypto.randomUUID()`，整次 session（单次 prompt 或 REPL 多轮）共用该 ID。
   - stderr 日志前缀、transcript payload、error 日志条目均使用 `sessionId`，便于用 `grep sessionId` 关联整段交互。

2. **Transcript 与 Error 分离**
   - **Transcript**：继续写入 `transcriptDir/*.json`，payload 含 `sessionId`；`meta.error` 保留，作为该次 run 的上下文快照。
   - **Error 独立日志**：新增 `transcriptDir/errors.jsonl`（JSON Lines），仅在发生护栏/业务错误并写入 transcript 后追加一条 `{ sessionId, timestamp, name, message, transcriptPath? }`；message 脱敏。与 transcript 解耦，便于单独 tail/grep 查全局失败。

## 涉及文件

- `packages/cli/src/infra/logger.ts`：`createSessionId`（替代 createRunId）、`setSessionId`/`clearSessionId`、`TranscriptPayload.sessionId`、`ErrorLogEntry`、`appendErrorLog`。
- `packages/cli/src/index.ts`：session 创建后生成并设置 sessionId；单次 prompt 与 REPL 分支改用 sessionId，错误分支在写 transcript 后调用 `appendErrorLog`；结束时 `clearSessionId()`。
- Runbook：Phase 4「日志系统与 sessionId」「Transcript 变更」「Error 独立日志」；Phase 6 安全/审计与验收中 sessionId 与 errors.jsonl。

## 验收

- 单次 prompt：stderr 与 transcript 同 sessionId；出错时 `errors.jsonl` 新增一行且含该 sessionId 与 transcriptPath。
- REPL：多轮共用同一 sessionId；任一轮出错都会在 `errors.jsonl` 追加一条；可用 `grep <sessionId> errors.jsonl` 与 transcript 关联。
