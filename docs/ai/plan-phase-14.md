# Phase 14 方案：使用 Ink 做 TUI 改造

## 目标

在交互式命令（REPL）中引入基于 **Ink** 的 TUI：当检测到 TTY 且 CLI 指定 `--tui` 时进入 Ink 模式，否则保持现有 readline REPL。TUI 展示当前模型、上下文状态（消息条数 / token 估算）、批准模式、Auto Memory 状态、历史区与流式输出，并保证 transcript 与现有行为一致。

## 实现要点

1. **依赖与构建**：增加 ink、ink-text-input、react；tsconfig 支持 jsx 与 .tsx。
2. **CLI 选项与分支**：`--tui` 选项；无 initialPrompt + TTY 且 `--tui` 时调用 `runTui()`，否则走 readline REPL；非 TTY 时 `--tui` 给出提示并退出。
3. **TUI 模块**：`packages/cli/src/tui/` 下 types、StatusBar、ContentArea、InputArea、App、index；`runTui(options)` 内 `render(<App options={options} />)` 并 `await waitUntilExit()`。
4. **布局**：状态栏（provider/model/approval/条数/token/Memory）、主内容区（历史+流式+工具摘要）、输入区（`> ` + TextInput）；批准时内容区显示提示，输入行接收 y/n。
5. **与现有逻辑集成**：复用 runOneTurn，注入 onStreamText（写 state）与 onApprovalRequest（Promise + 下次提交解析 y/n）；退出时 onExit 写 transcript、clearSessionId、process.exit(0)。
6. **信息源**：provider/model 来自 ResolvedConfig；条数/token 来自 session.getMessages()、estimateTokens；Memory 来自 transcriptMeta.autoMemoryLoaded。

## 验收标准（DoD）

- 使用 `--tui` 且在 TTY 下启动 REPL 时，出现 Ink 界面，状态栏正确显示模型、上下文信息与批准模式。
- 在 TUI 中完成至少一轮带工具调用的对话，流式输出与工具结果展示正常，退出后 transcript 正确生成。
- 未使用 `--tui` 时现有 REPL 行为不变；非 TTY 下 `--tui` 不崩溃并给出明确提示。
- `pnpm -r build`、`pnpm -r typecheck` 通过；已有 Phase 典型命令无回归。

详见 [09-cli-advanced-roadmap.md](09-cli-advanced-roadmap.md) § Phase 14 与 [14-phase14-runbook.md](14-phase14-runbook.md)。
