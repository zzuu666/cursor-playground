# Phase 14 运行与验证说明（Ink TUI）

## 核心原理回顾

| 能力 | 核心原理 |
|------|----------|
| TUI 入口 | 当无 `--prompt`、在 TTY 且传入 `--tui` 时，进入 Ink TUI 模式；否则保持原有 readline REPL。 |
| 技术选型 | 使用 **Ink**（React for CLI）渲染 TUI；输入使用 **ink-text-input**，流式输出通过 `onStreamText` 回调写入 React state 驱动重绘。 |
| 布局 | **状态栏**（顶部）：provider、model、approval、上下文条数、token 估算（Phase 13 的 estimateTokens）、Auto Memory 状态。**主内容区**：历史对话与当前轮次流式输出、工具调用与结果摘要。**输入区**（底部）：`> ` 前缀 + 单行输入，Enter 提交；空行退出。 |
| 与现有逻辑 | Provider、Loop、Session、Transcript 均复用；TUI 仅作为 REPL 的另一种前端。`runOneTurn` 由 index 注入，TUI 传入 `onStreamText`（流式写入 state）与 `onApprovalRequest`（批准时在内容区显示提示，下一行输入 y/n 解析后 resolve Promise）。 |
| 退出与 transcript | 用户输入空行后调用 `onExit`：写 transcript（与现有 REPL 格式一致）、clearSessionId、process.exit(0)。 |

## 运行方式

从仓库根或 `packages/cli` 执行；**TUI 需在真实 TTY 下运行**（本地终端或 SSH 会话）。

| 场景 | 命令（示例） |
|------|----------------|
| 启动 TUI（mock） | `mini-agent --tui --provider mock` 或 `pnpm exec tsx packages/cli/src/index.ts --tui --provider mock` |
| 启动 TUI + 流式 | `mini-agent --tui --stream --provider mock` |
| 启动 TUI + 批准 prompt | `mini-agent --tui --approval prompt --provider mock` |
| 非 TTY 下传 --tui | `echo "" \| mini-agent --tui` → 提示需 TTY，退出码 1；或 CI 无 TTY 时同样提示。 |
| 不使用 TUI（原有 REPL） | `mini-agent --provider mock`（无 `--tui`）→ 行为与 Phase 13 一致，readline `> ` 输入。 |

## 成功路径验证

1. **TUI 启动**：在 TTY 下执行 `mini-agent --tui --provider mock`，出现 Ink 界面；状态栏显示 provider、model、approval、msgs、tokens≈、Memory 状态。
2. **单轮对话**：在 TUI 输入一行（如 `hello`）并 Enter，内容区出现 You / Assistant 的对话摘要；mock 下立即返回固定文案。
3. **流式输出**：使用 `--tui --stream --provider <真实 provider>`（需配置 API Key），输入后内容区应逐步追加模型输出。
4. **工具调用**：在 TUI 中发会触发工具调用的指令（如「读当前目录下某文件」），内容区出现 `[tool] xxx` 等摘要；若 `--approval prompt`，内容区出现批准提示，输入 `y` 或 `n` 后继续。
5. **退出与 transcript**：输入空行，TUI 退出；终端输出 `sessionId=... transcript=<path>`；打开该 transcript JSON，应含 sessionId、provider、policy、messages、skillsLoaded 等与现有 REPL 一致字段。

## 异常/失败路径验证（如适用）

- **非 TTY + --tui**：提示 "Please pass --prompt or run in TTY for REPL" 及 "--tui requires TTY"；退出码 1，不崩溃。
- **TUI 内错误**：若某轮 runOneTurn 抛出 LoopLimitError / LoopSpinDetectedError，TUI 在内容区下方显示 error 文案，并写入 transcript（含 meta.error）与 errors.jsonl；不退出 TUI，可继续输入。
- **批准流程**：`--approval prompt` 下工具需批准时，内容区显示 `[approval] Approve tool "xxx"? (y/n ...)`；输入 `y` 或 `n` 后该轮继续，行为与 readline REPL 一致。

## 验收标准（DoD）

- 使用 `--tui` 且在 TTY 下启动 REPL 时，出现 Ink 界面；状态栏正确显示当前 provider、model、approval 模式、上下文条数或 token 估算、Auto Memory 状态。
- 在 TUI 中完成至少一轮带工具调用的对话：流式输出与工具结果在内容区正常展示；若 approval 为 prompt，批准流程可用（y/n）完成。
- 退出 TUI（空行）后，transcript 仍正确生成，格式与现有 REPL 一致，且 sessionId、messages、skillsLoaded 等齐全。
- 未使用 `--tui` 时，现有 REPL 行为完全不变；非 TTY 下使用 `--tui` 时不崩溃，且给出明确提示。
- `pnpm -r build`、`pnpm -r typecheck` 通过；已有 Phase 的典型命令（如 `mini-agent --provider mock --prompt "hi"`）无回归。
