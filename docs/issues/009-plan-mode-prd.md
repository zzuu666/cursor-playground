# PRD：Plan Mode 产品需求文档

> 基于 [Claude Code Common Workflows - Plan Mode](https://code.claude.com/docs/en/common-workflows#use-plan-mode-for-safe-code-analysis) 的实践整理，用于指导 CLI 中「Plan 模式」与「Agent / Plan 双模式切换」的设计与实现。

## 1. 产品概述

### 1.1 目标

在现有 **Agent 模式**（直接执行工具、受 `--approval` 等策略约束）之外，增加 **Plan 模式**，实现「先分析、再执行」的安全工作流：

- 在**只读**或**计划优先**的前提下分析代码库、设计多步骤方案，不直接落盘或执行命令；
- 通过模式切换（含 TUI 内 **Shift+Tab**）与 CLI/配置入口，让用户显式选择当前是「执行」还是「规划」。

### 1.2 核心原则

- Plan 模式以**只读与计划产出**为主：仅允许只读类工具，写/执行类工具不实际调用（或仅在计划中描述）。
- 可与用户交互澄清需求后再产出计划（等价于 AskUserQuestion：在生成计划前收集目标与约束）。
- 当前仅支持 **Agent** 与 **Plan** 两种模式，通过 Shift+Tab 在 TUI 内循环切换，不引入第三种 permission 模式。

---

## 2. 模式定义

| 维度         | Agent 模式                     | Plan 模式                                   |
|--------------|--------------------------------|---------------------------------------------|
| **定位**     | 直接执行、可写可执行           | 只读分析、产出计划，不执行写/执行类工具     |
| **工具范围** | 所有已注册工具，受 approval 约束 | 仅只读工具可用；写/执行类禁止或仅描述不调用 |
| **产出**     | 对话 + 实际文件/命令结果        | 对话 + 计划文本/结构化步骤                  |
| **典型用途** | 改代码、跑命令、写文件         | 探索代码库、设计重构/迁移方案、对齐方向     |

- **Agent 模式**：保持现有行为——可执行所有已注册工具（read_file、write_file、execute_command、memory_write、glob_search 等），受 `--approval`（never / auto / prompt）约束。
- **Plan 模式**：
  - **只读工具**（如 read_file、glob_search 等）：允许正常调用，用于分析代码与结构。
  - **写/执行类工具**（write_file、execute_command、memory_write 等）：禁止实际执行；模型可在计划中描述「将执行某操作」，但不发起真实调用；或返回明确拒绝信息引导用户切回 Agent 再执行。
  - 产出为**计划**（自然语言或结构化步骤）；用户确认后可在 Agent 模式下按计划执行（执行流程可作为后续迭代，本 PRD 首版聚焦「计划产出」与模式切换）。

参考 Claude Code：Plan Mode 通过 read-only 分析与 AskUserQuestion 收集需求，再生成计划。

---

## 3. 使用场景（When to use Plan Mode）

- **多步骤、多文件改动前的探索与方案设计**：先出迁移/重构计划，再在 Agent 模式下执行。
- **熟悉新代码库**：只读浏览与总结，不落盘、不执行命令，避免误改。
- **交互式规划**：希望先与 AI 对齐目标与约束，再生成计划或切回 Agent 执行。

---

## 4. 入口与切换

### 4.1 CLI 启动

- 新增启动参数，与现有 `--approval` 等并列，例如：
  - `--mode <mode>` 或 `--permission-mode <mode>`，取值：`agent` | `plan`。
- 未指定时使用配置或默认值（见 4.2）。
- Headless（`-p "..."`）时同样支持，例如：`mini-agent --mode plan -p "分析认证模块并给出重构方案"`。

### 4.2 默认模式配置

- 配置文件（如 `mini-agent.config.json` 或 `.mini-agent.json`）中支持配置默认模式，例如：
  - `defaultMode: "agent"` | `"plan"`（或等价字段名，与现有 config 命名风格一致）。
- 优先级：CLI 参数 &gt; 配置文件 &gt; 默认值（默认值为 `agent`）。

### 4.3 TUI 内 Shift+Tab 切换

- 在 TUI 中按 **Shift+Tab** 在 **Agent** 与 **Plan** 之间**循环切换**（仅此两种模式）。
- 当前模式在界面有明确展示：
  - 在状态栏（StatusBar）或输入区旁展示当前模式，如 `mode=Agent` 或 `mode=Plan`，与现有 `approval=...`、`msgs=...` 等信息并列。
- 切换后立即生效：下一轮对话即按新模式执行（只读/计划 vs 全工具执行）。

---

## 5. 行为约束与配置

### 5.1 Plan 模式下的工具策略

- **允许调用**：read_file、glob_search 等只读、不改变工作区或外部状态的工具。
- **禁止实际执行**：write_file、execute_command、memory_write 等；模型若请求这类工具，应得到明确拒绝或「仅计划中描述」的说明，不执行真实调用。
- 实现方式可以是：在 Plan 模式下对工具注册表做过滤（仅暴露只读工具），或在校验阶段拦截写/执行类工具并返回统一提示。

### 5.2 可选：生成计划前询问用户（AskUserQuestion）

- Plan 模式下可在生成计划前通过一次或多次「询问用户」收集目标、约束与边界条件，再产出计划。
- 实现方式可为：在 system prompt 或流程中约定「先问再计划」，或提供专用交互入口（如 TUI 内弹问）；具体交互形式可在实现阶段细化。

---

## 6. 非功能需求与后续扩展

- **可观测性**：状态栏/提示必须明确当前模式，避免用户误以为在 Agent 下执行写操作而实际处于 Plan。
- **首版非目标**（可留作后续迭代）：
  - 在编辑器中打开计划（如 Ctrl+G 打开计划文档）；
  - 引入第三种 permission 模式（如 Auto-Accept）；
  - 从计划一键切换回 Agent 并「按计划执行」的自动化流程（可先由用户手动切回 Agent 后按计划描述操作）。

---

## 7. 相关代码与配置

实现时可能涉及以下模块，供开发对齐：

| 模块 / 文件 | 说明 |
|-------------|------|
| [packages/cli/src/config.ts](packages/cli/src/config.ts) | 扩展 ConfigFile / ResolvedConfig，增加 `defaultMode` 或等价字段及解析。 |
| [packages/cli/src/index.ts](packages/cli/src/index.ts) | 解析 `--mode` / `--permission-mode`，与 config 合并得到当前 mode；headless 与 REPL 分支均需传入 mode。 |
| [packages/cli/src/agent/loop.ts](packages/cli/src/agent/loop.ts) | 根据当前 mode 过滤或限制工具（Plan 下仅只读工具可执行）；写/执行类请求返回统一拒绝或说明。 |
| [packages/cli/src/tui/App.tsx](packages/cli/src/tui/App.tsx) | 维护「当前 mode」状态；监听 Shift+Tab，在 Agent ⇄ Plan 间切换并回调或更新 runOneTurn 所用 mode。 |
| [packages/cli/src/tui/StatusBar.tsx](packages/cli/src/tui/StatusBar.tsx) | 展示当前 mode（如 `mode=Agent` / `mode=Plan`），与 approval、msgs、tokens 等并列。 |
| [packages/cli/src/tui/types.ts](packages/cli/src/tui/types.ts) | TuiOptions 等如需传入或接收当前 mode、切换回调，可在此扩展。 |

---

## 8. 参考资源

- [Common workflows - Use Plan Mode for safe code analysis](https://code.claude.com/docs/en/common-workflows#use-plan-mode-for-safe-code-analysis)
- 本项目 [docs/issues/008-memory-prd.md](docs/issues/008-memory-prd.md)（PRD 结构与风格参考）

---

## 9. 文档与变更记录

- **来源**：Claude Code Common Workflows - Plan Mode 章节
- **用途**：作为 CLI Plan 模式与 Agent/Plan 双模式切换（含 Shift+Tab）的设计与实现基准
- **更新**：可根据实现与反馈对本 PRD 做修订
