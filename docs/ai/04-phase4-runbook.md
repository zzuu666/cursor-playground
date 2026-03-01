# Phase 4 运行与验证说明（配置与可观测性）

## 核心原理回顾

| 能力 | 核心原理 |
|------|----------|
| 配置文件 | 支持 `mini-agent.config.json` 或 `.mini-agent.json`（cwd 下）；或通过 `--config <path>` 显式指定。配置文件为 JSON，可包含 `provider`、`model`、`transcriptDir`、`baseURL`、`policy`（部分覆盖）等。 |
| 配置合并顺序 | **默认值 → 配置文件 → 环境变量 → CLI 选项**（优先级从低到高）。未指定项保持上一层级结果。 |
| 可观测性 | `--verbose` 时：每轮请求前输出 `[verbose] turn N request: M messages`；每轮响应后输出 `[verbose] turn N response: K blocks, text L chars`；每个工具调用后输出 `[verbose] tool <name> inputLen=X resultLen=Y`（或 `error`）。 |
| dry-run | `--dry-run` 时仅解析 prompt 与已注册工具列表，输出到 stderr 后退出，不调用 LLM 与工具。无需 API key。 |
| 退出码 | `0` 成功（含 dry-run）；`1` 业务/护栏错误（空转终止、达到 maxTurns/maxToolCalls 等）；`2` 配置/环境错误（如缺少 MINIMAX_API_KEY、配置文件不存在或 JSON 非法）。 |

## 策略参数（policy，可通过配置文件或后续 CLI 覆盖）

与 Phase 3 一致，见 [03-phase3-runbook.md](03-phase3-runbook.md)。配置文件内可用 `policy` 对象部分覆盖，例如：

```json
{
  "provider": "minimax",
  "transcriptDir": "./my-transcripts",
  "policy": {
    "maxTurns": 6,
    "maxSameToolRepeat": 2
  }
}
```

## 运行方式

从 `packages/cli` 或仓库根执行。Phase 4 新增 `--config`、`--verbose`、`--dry-run`、`--model`。

| 场景 | 命令（示例） |
|------|----------------|
| 无配置文件、仅 CLI（与 Phase 3 兼容） | `pnpm exec tsx src/index.ts --provider mock --prompt "hi"` |
| 使用 cwd 下配置文件 | 在 cwd 放置 `mini-agent.config.json` 后执行 `pnpm exec tsx src/index.ts --prompt "读取 package.json"`（provider/model 等从文件读） |
| 显式指定配置文件 | `pnpm exec tsx src/index.ts --config ./my-config.json --prompt "hello"` |
| CLI 覆盖配置文件 | `pnpm exec tsx src/index.ts --prompt "hello"`（文件里 provider 为 minimax 时，可加 `--provider mock` 覆盖） |
| 每轮与工具概况（verbose） | `pnpm exec tsx src/index.ts --provider mock --prompt "hello" --verbose` |
| 仅解析 prompt 与工具（dry-run） | `pnpm exec tsx src/index.ts --prompt "读文件" --dry-run` |

## 日志系统与 sessionId

- **sessionId**：在创建 AgentSession 时生成唯一 UUID（如 `a1b2c3d4-e5f6-7890-abcd-ef1234567890`），用于关联整次 session 的 stderr、transcript 与 error 日志。单次 prompt 为 1 session；REPL 多轮共用同一 sessionId。
- **stderr 前缀**：当次 session 内，`[tool]`、`[turn N]`、`[stream]` 等日志行会带 `[sessionId] ` 前缀，便于用 `grep sessionId` 过滤。
- **结束输出**：成功时输出 `sessionId=xxx turns=... transcript=<path>`；错误时输出 `error: ... sessionId=xxx transcript=<path>`。

## 运行时日志（stderr）

- **Phase 3 已有**：`[turn N] tools=K, elapsed=XXXms`、`[tool] name input: ...` 等。
- **sessionId 前缀**：上述日志在当次 session 内带 `[<sessionId>] ` 前缀，例如 `[a1b2c3d4-e5f6-...] [tool] read_file input: {...}`。
- **Phase 4 verbose 新增**：
  - 每轮请求前：`[verbose] turn N request: M messages`
  - 每轮响应后：`[verbose] turn N response: K blocks, text L chars`
  - 每个工具调用后：`[verbose] tool <name> inputLen=X resultLen=Y` 或 `inputLen=X error`
- **dry-run**：`[dry-run] prompt: <prompt>`、`[dry-run] tools: tool1, tool2, ...`

## Transcript 变更

- **sessionId**：每条 transcript JSON 必含 `sessionId`，与 stderr 及 error 日志中的 sessionId 一致，便于用 ID 查找对应 transcript。
- **错误记录（meta.error）**：若 run 因护栏/业务错误终止（如 maxTurns、maxToolCalls、空转检测），transcript 的 `meta` 中会包含 `error: { name, message }`，作为该次 run 的上下文快照，例如：
  ```json
  "meta": { "spinDetected": true, "error": { "name": "LoopSpinDetectedError", "message": "Same tool call repeated 3 times: read_file" } }
  ```
 或 `"error": { "name": "LoopLimitError", "message": "maxTurns exceeded: 12" }`。

## Error 独立日志

- **路径**：`<transcriptDir>/errors.jsonl`（JSON Lines，一行一条记录）。
- **写入时机**：仅在发生护栏/业务错误（如 LoopLimitError、LoopSpinDetectedError）并写入 transcript 之后追加一条，与 transcript 解耦。
- **单条格式**：`{ "sessionId", "timestamp", "name", "message", "transcriptPath?" }`；`message` 会经脱敏后写入。
- **用途**：便于运维单独 `tail -f` 或 `grep <sessionId>` 查看全局失败列表，再通过 `transcriptPath` 或 sessionId 关联到对应 transcript。

## 成功路径验证

- **无配置文件**：`--provider mock --prompt "hi"` 行为与 Phase 3 一致，退出码 0。
- **有配置文件**：cwd 下放置 `mini-agent.config.json`（如 `{"provider":"minimax","policy":{"maxTurns":5}}`），不传 `--provider` 时使用 minimax 且 maxTurns=5；再传 `--provider mock` 时 provider 被覆盖为 mock。
- **--config 指定路径**：`--config /path/to/custom.json` 时仅读取该文件；若路径不存在则退出码 2。
- **--verbose**：同一任务下 stderr 出现 `[verbose] turn N request: ...`、`[verbose] turn N response: ...` 及工具调用的 `inputLen`/`resultLen`。
- **--dry-run**：仅输出 prompt 与工具列表，无 LLM/工具调用，退出码 0；无需设置 MINIMAX_API_KEY。

## 异常/失败路径验证

- **配置错误（exit 2）**：
  - 显式 `--config /nonexistent.json`：应报错「Config file not found」并 exitCode 2。
  - provider 为 minimax 且未设置 MINIMAX_API_KEY：应报错并 exitCode 2。
  - 配置文件 JSON 非法或非对象：应报错并 exitCode 2。
- **业务/护栏错误（exit 1）**：与 Phase 3 一致（如空转终止、maxTurns 达到），stderr 报错并写入 transcript，exitCode 1。

## 退出码（DoD 可复验）

| 退出码 | 含义 | 示例 |
|--------|------|------|
| 0 | 成功完成（含 dry-run） | 正常单轮/多轮、dry-run 仅打印 |
| 1 | 业务或护栏错误 | 空转终止、maxTurns/maxToolCalls 达到、其他运行时错误 |
| 2 | 配置或环境错误 | 缺少 MINIMAX_API_KEY、--config 路径不存在或 JSON 非法 |

## 验收标准（DoD）

- `pnpm -r build` 与 `pnpm -r typecheck` 通过。
- 指定 `--config` 或工作目录下配置文件生效，且被 CLI 参数覆盖（见「成功路径验证」）。
- `--verbose` 下能看到每轮摘要与工具调用概况（见「运行时日志」）。
- 文档中明确退出码含义（见「退出码」），且上述成功/异常路径可复验。
- **日志与 Transcript**：每次 session 有唯一 sessionId（UUID）；stderr 日志带 sessionId 前缀；transcript JSON 含 `sessionId`；因错误终止时 transcript 的 `meta.error` 含 `name` 与 `message`；同时会向 `transcriptDir/errors.jsonl` 追加一条独立 error 记录（含 sessionId、transcriptPath），便于全局查错。
- 已有 Phase 的 runbook 示例命令（如 Phase 2、Phase 3）仍能按预期工作，无回归。
