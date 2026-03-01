# Phase 5 运行与验证说明（用户批准流）

## 核心原理回顾

| 能力 | 核心原理 |
|------|----------|
| 批准策略 | `--approval never \| auto \| prompt`（或配置文件 `approval`）。`never`：需批准的工具一律不执行并注入拒绝说明；`auto`：需批准的工具直接执行；`prompt`：需批准的工具执行前等待用户输入 y/n（可带拒绝理由）。 |
| 工具标记 | 在 `Tool` 上可设置 `requiresApproval?: boolean`。仅当为 `true` 且策略为 `prompt` 时触发交互；策略为 `never` 时直接拒绝；策略为 `auto` 时直接执行。 |
| Loop 集成 | 执行 `tool_use` 前：若工具 `requiresApproval === true`，按当前策略决定等待用户、自动通过或拒绝，拒绝时注入 `tool_result` 说明被拒绝并让模型继续推理。 |
| Transcript 审计 | 每次批准/拒绝写入当次 run 的 `approvalLog` 数组（工具名、参数摘要、decision、可选 userReason、timestamp），最终 transcript JSON 含 `approvalLog` 便于复盘。 |

## 策略参数（approval）

| 参数 | 默认值 | 含义 |
|------|--------|------|
| `approval` | `auto` | `never`：禁止需批准的工具；`auto`：自动通过；`prompt`：每次需批准的工具前等待用户 y/n 或 n &lt;理由&gt;。 |

配置文件示例：

```json
{
  "approval": "prompt"
}
```

CLI 覆盖：`--approval never`、`--approval auto`、`--approval prompt`。

## 运行方式

从 `packages/cli` 或仓库根执行。Phase 5 新增 `--approval`。

| 场景 | 命令（示例） |
|------|----------------|
| 默认 auto（与 Phase 4 兼容） | `pnpm exec tsx src/index.ts --provider mock --prompt "hi"` |
| 禁止需批准的工具 | `pnpm exec tsx src/index.ts --approval never --prompt "..."` |
| 每次需批准时等待用户 | `pnpm exec tsx src/index.ts --approval prompt --prompt "..."`（需 TTY） |
| 配置文件指定 approval | 在 `mini-agent.config.json` 中设置 `"approval": "prompt"` 后执行，可被 `--approval` 覆盖 |

## 运行时日志（stderr）

- **Phase 4 已有**：`[verbose]`、`[tool]`、`[turn N]` 等。
- **Phase 5 批准交互**：当 `--approval prompt` 且工具 `requiresApproval === true` 时，会输出 `[approval] Approve tool "<name>"? (y/n or n <reason>): ` 并等待输入。
- **批准拒绝时**：`[tool] <name> error: rejected by user or policy`；`--verbose` 时另有 `[verbose] tool <name> approval rejected`。

## 成功路径验证

- **--approval auto**：行为与 Phase 4 一致，无交互；若有工具带 `requiresApproval: true` 也会直接执行，approvalLog 中可记 approved。
- **--approval never**：若有工具 `requiresApproval: true`，不执行该工具，注入 tool_result 说明「策略为 never，请求被拒绝」，模型可继续；transcript 的 `approvalLog` 中有 `rejected` 记录。
- **--approval prompt**（TTY）：当某工具 `requiresApproval: true` 时，暂停并输出 `[approval] Approve tool "..."? (y/n or n <reason>): `；输入 `y` 或 `yes` 执行，输入 `n` 或 `no`（可后跟理由）拒绝；拒绝后模型收到明确 tool_result 并可继续推理；transcript 含对应 approvalLog。
- **Transcript**：单次 run 结束后，生成的 transcript JSON 中若有批准/拒绝则包含 `approvalLog` 数组，含 `toolName`、`inputSummary`、`decision`、可选 `userReason`、`timestamp`。

## 异常/失败路径验证

- **--approval prompt 且非 TTY**：自动退化为 `never`，stderr 输出 `mini-agent: --approval prompt requires TTY; falling back to never.`，需批准的工具不执行并注入拒绝说明。
- **业务/护栏错误（exit 1）**：与 Phase 4 一致（空转、maxTurns 等）；若在 run 中发生，transcript 仍可含已有 approvalLog（若有）。

## 安全/约束

- 批准流仅对声明了 `requiresApproval: true` 的工具生效；当前 Phase 5 未给 read_file、glob_search 设置该标记，Phase 6 的 write_file/execute_command 将设为 true。
- `prompt` 模式依赖 TTY；非 TTY 时自动按 `never` 处理，避免无头环境阻塞。
- 拒绝时的 tool_result 使用 `is_error: false`，便于模型区分「用户拒绝」与「工具执行错误」。

## 验收标准（DoD）

- `pnpm -r build` 与 `pnpm -r typecheck` 通过。
- `--approval prompt` 时，需批准的工具会暂停并等待 y/n（及可选理由）；拒绝后模型收到明确 tool_result 并可持续推理。
- `--approval never` 时，需批准的工具不执行，注入说明「策略为 never」的 tool_result，并记入 approvalLog。
- `--approval auto` 时，与既有行为一致，需批准的工具也直接执行；approvalLog 可记 approved。
- Transcript 中可复盘：生成的 transcript JSON 在发生批准/拒绝时包含 `approvalLog` 数组，含工具名、参数摘要、decision、可选 reason。
- 配置文件可设置 `approval`，CLI `--approval` 覆盖配置文件；Runbook 中说明默认值与含义。
- 无回归：Phase 1–4 的典型命令（如 `--provider mock --prompt "hi"`）仍能按预期工作。
