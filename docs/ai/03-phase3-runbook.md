# Phase 3 运行与验证说明（稳定性与可解释性增强）

## 核心原理回顾

| 能力 | 核心原理 |
|------|----------|
| 重试策略 | 仅对可重试错误（429、5xx、ECONNRESET、ETIMEDOUT 等）自动重试；4xx（除 429）及业务错误不重试。Provider 层用 `retryWithBackoff` 包裹 API 调用。 |
| 空转检测 | 同一工具 + 相同参数（指纹：`name` + `JSON.stringify(sortKeys(input))`）被调用达到 `maxSameToolRepeat` 次即终止，抛出 `LoopSpinDetectedError`，避免无限循环。 |
| 会话摘要 | 当 `messages.length > summaryThreshold` 时，用规则生成摘要替换早期消息，保留最近 `summaryKeepRecent` 条，避免 token 溢出与失忆。 |
| 诊断信息 | 每轮结束向 stderr 输出 `[turn N] tools=K, elapsed=XXXms`；单次 run 返回 `diagnostics` 与 `elapsedTotalMs`；transcript 可含 `result`、`meta` 便于复盘。 |

## 策略参数（policy）

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `maxRetries` | 3 | Provider API 调用可重试次数 |
| `retryDelayMs` | 1000 | 重试间隔基数（退避：第 n 次重试等待 n × retryDelayMs） |
| `maxSameToolRepeat` | 3 | 同一工具同参数最多允许重复调用次数，超过即空转终止 |
| `summaryThreshold` | 16 | 消息条数超过此值触发摘要压缩 |
| `summaryKeepRecent` | 8 | 摘要后保留的最近消息条数 |

## 运行方式

与 Phase 1、Phase 2 相同，从 `packages/cli` 或仓库根执行。Phase 3 的增强对用户透明，无需改命令。

| 场景 | 命令（示例） |
|------|----------------|
| 单轮（含诊断） | `pnpm exec tsx src/index.ts --prompt "读取 package.json 并总结"` |
| 多轮 REPL（可能触发摘要） | `pnpm exec tsx src/index.ts`，连续多轮对话超过约 16 条消息时会压缩早期上下文 |
| Mock | `pnpm exec tsx src/index.ts --provider mock --prompt "hello"` |

## 运行时日志（stderr）

除 Phase 2 已有的 `[stream]`、`[tool]` 外，Phase 3 新增：

- **每轮诊断**：每轮 LLM 结束（无论是否有 tool_use）输出一行 `[turn N] tools=K, elapsed=XXXms`，其中 `tools` 为截至该轮的累计工具调用次数，`elapsed` 为该轮耗时（毫秒）。
- **终端汇总**：单次运行结束输出 `turns=..., toolCalls=..., elapsed=...ms`，REPL 每轮后输出 `[turns=..., toolCalls=..., elapsed=...ms]`。

## Transcript 增强

- **result**（成功结束时）：`turns`、`toolCalls`、`diagnostics`（每轮的 turn、toolCount、elapsedMs）、`elapsedTotalMs`。
- **meta**（异常结束时）：如发生空转终止则包含 `spinDetected: true`，便于复盘时区分正常结束与护栏触发。

## 成功路径验证

- **正常单轮**：`--provider mock --prompt "hello"` 输出 `[turn 1] tools=0, elapsed=...ms` 及 `turns=1, toolCalls=0, elapsed=...ms`，transcript 中带 `result.diagnostics`、`result.elapsedTotalMs`。
- **带工具多轮**：如“读文件并总结”，stderr 可见多行 `[turn N] tools=K, elapsed=...ms`，transcript 的 `result.diagnostics` 与轮次、工具调用数一致。
- **长对话摘要**：REPL 下多轮对话使消息数超过 16 条后，下一轮请求前会触发摘要，会话仍能延续且不出现明显失忆（可问“之前我们聊过什么？”简单验证）。

## 异常路径验证

- **空转终止**：若模型连续用相同参数调用同一工具达到 3 次，应抛出 `LoopSpinDetectedError`，stderr 输出错误信息，并写入带 `meta.spinDetected: true` 的 transcript，进程以 exitCode 1 退出。
- **重试**：Provider 层对 429、5xx、网络超时等会按 policy 重试；4xx（除 429）不重试，直接失败。可通过断网或 mock 5xx 观察重试行为（需自行构造或单元测试）。

## 验收标准（DoD）

- `pnpm -r build` 与 `pnpm -r typecheck` 通过。
- 异常场景有稳定退出路径，不会无限循环（空转时由 `LoopSpinDetectedError` 终止）。
- 长对话时上下文控制稳定，摘要触发后后续轮次能正确引用上下文。
- 每轮 stderr 有 `[turn N] tools=K, elapsed=XXXms`；单次运行输出含 `elapsed=...ms`。
- 任意一段会话可基于 transcript 复盘：成功时有 `result`（含 diagnostics），空转终止时有 `meta.spinDetected`。
