---
name: Code Agent 商用学习计划
overview: 在已完成 Phase 0–3（Agent Loop、工具、稳定性）的基础上，按「安全优先、体验渐进、可交付」的顺序，分阶段学习并实现可商用 Code Agent CLI 所需的能力：配置与可观测性、用户批准流、写/执行工具、多 Provider、CLI 体验与分发。
todos: []
isProject: false
---

# Code Agent 商用化学习计划（Phase 4 及以后）

你已完成 [00-initialization-plan.md](docs/ai/00-initialization-plan.md) 中的 Phase 0–3，掌握了 Agent Loop、tool_use/tool_result、重试/空转检测/会话摘要与 transcript 复盘。下一步是在**不破坏既有可解释性**的前提下，循序渐进地补齐「可商用」所需能力。

---

## 目标与原则

- **最终目标**：可商用的 Code Agent CLI（能读能写能执行、安全可控、体验清晰、可安装可配置）。
- **循序渐进**：先配置与可观测性 → 再用户批准流 → 再高权限工具 → 再多 Provider 与分发。
- **文档与验收**：每个 Phase 仍按 [phase-implementation-sop.md](docs/ai/phase-implementation-sop.md) 执行（Plan → Code → Runbook → DoD）。

---

## Phase 4：配置与可观测性（商用基础）

**目标**：从「写死/环境变量」升级为「可配置、可观测」，为后续批准流和工具扩展打基础。

**建议实现要点**：

1. **配置文件**：支持 `mini-agent.config.json`（或 `.mini-agent.json`）或 `--config <path>`，包含：`provider`、`model`、`transcriptDir`、`policy`（如 `maxTurns`、`maxSameToolRepeat`、`summaryThreshold`）等；CLI 参数覆盖配置文件。
2. **统一配置加载**：在 [config.ts](packages/cli/src/config.ts) 中扩展：合并默认值 → 配置文件 → 环境变量 → CLI 选项（优先级从低到高）。
3. **可观测性**：增加 `--verbose`（打印每轮请求/响应的摘要、工具入参/结果长度），以及 `--dry-run`（只解析 prompt 与工具规划，不真正调用 LLM/工具，可选）。
4. **错误与退出码**：规范退出码（如 0 成功、1 业务/护栏错误、2 配置/环境错误），并在 Runbook 中说明。

**验收（DoD）**：

- 指定 `--config` 或工作目录下配置文件生效，且被 CLI 参数覆盖。
- `--verbose` 下能看到每轮摘要与工具调用概况。
- 文档中明确退出码含义，且 DoD 可复验。

**学习收益**：配置分层、CLI 与配置的优先级约定、可观测性设计。

---

## Phase 5：用户批准流（安全基础）

**目标**：在高权限工具接入前，先实现「用户对单次工具调用的批准/拒绝」机制，保证后续 write/execute 可控。

**建议实现要点**：

1. **批准策略**：配置或 CLI 选项，如 `--approval never | auto | prompt`。`never` 禁止需批准的工具；`auto` 自动通过；`prompt` 在每次需批准的工具前等待用户输入（y/n/理由）。
2. **工具标记**：在 [tools/types.ts](packages/cli/src/tools/types.ts) 中为工具定义 `requiresApproval?: boolean`；仅当为 `true` 且策略为 `prompt` 时触发交互。
3. **Loop 集成**：在 [agent/loop.ts](packages/cli/src/agent/loop.ts) 中，在执行 `tool_use` 前若需批准则等待用户输入，拒绝则注入 `tool_result` 说明被拒绝并让模型继续。
4. **Transcript**：记录每次批准/拒绝（含工具名、参数摘要、用户选择），便于审计。

**验收（DoD）**：

- `--approval prompt` 时，需批准的工具会暂停并等待 y/n。
- 拒绝后模型能收到明确 tool_result 并继续推理（如换方案）。
- Transcript 中可复盘批准/拒绝记录。

**学习收益**：交互式安全护栏、工具元数据与策略解耦。

---

## Phase 6：写与执行工具（能力闭环）

**目标**：在批准流保护下，接入 `write_file` 与 `execute_command`，完成「读-查-写-执行」闭环。

**建议实现要点**：

1. **write_file**：路径限制沿用 [tools/safe-path.ts](packages/cli/src/tools/safe-path.ts)（工作目录内），可选「备份已存在文件」或「覆盖前确认」；标记 `requiresApproval: true`，默认 `--approval prompt` 时需用户确认。
2. **execute_command**：限制为允许列表（如 `npm`、`pnpm`、`node`、`npx`、`git` 等）或配置项；禁止直接 `rm -rf` 等；标记 `requiresApproval: true`；超时与输出长度上限（如 32KB）。
3. **安全与审计**：所有写/执行在 transcript 中记录完整参数与结果摘要；批准流记录保留。

**验收（DoD）**：

- 在批准流开启时，write_file/execute_command 会触发确认；拒绝后模型可继续。
- 路径与命令白名单生效，越权请求被拒绝并返回清晰 tool_result。
- Transcript 可审计所有写/执行及批准结果。

**学习收益**：高权限工具设计、白名单与边界控制。

---

## Phase 7：多 Provider 与韧性（可选）

**目标**：支持多 LLM 后端（如 OpenAI 兼容、MiniMax、本地模型），并具备简单降级或明确错误提示。

**建议实现要点**：

1. **Provider 抽象**：已有 [providers/base.ts](packages/cli/src/providers/base.ts)，扩展为「模型名 + 参数」可配置（如从配置文件读 `provider`、`model`、`baseURL`）。
2. **多 Provider 实现**：新增 1 个以上 Provider（如 OpenAI 兼容 API），统一通过 base 接口调用。
3. **错误与降级**：当主 Provider 不可用（如 429、5xx）时，可配置 fallback 到另一 Provider，或明确报错并提示检查配置/网络。

**验收（DoD）**：

- 通过配置切换 Provider 并成功完成对话与工具调用。
- 文档说明各 Provider 所需环境变量与配置项。

**学习收益**：多后端抽象、配置驱动的 Provider 选择。

---

## Phase 8：CLI 体验与分发（可交付）

**目标**：让 CLI 易于安装、配置和日常使用，达到「可交付」状态。

**建议实现要点**：

1. **体验**：改进帮助文案、`--version`、示例命令；可选引入轻量输出格式化（如 chalk 或保持纯文本但结构化 stderr）。
2. **打包**：`pnpm build` 产出可执行（如 `dist/index.js`），支持 `node dist/index.js` 或通过 `bin` 安装；考虑 `pkg` 或 `nexe` 生成单一可执行文件（可选）。
3. **发布**：npm 包发布准备（`package.json` 的 `bin`、`files`、engines）；README 含安装、配置、批准流与安全说明、示例。

**验收（DoD）**：

- 通过 `pnpm add -g <your-pkg>` 或 `npx` 可安装并运行。
- README 包含安装、最小配置、安全与批准流说明、退出码与 transcript 说明。

**学习收益**：CLI 打包与发布、用户文档与安全告知。

---

## 建议学习顺序与时间节奏


| 阶段      | 重点                           | 建议节奏       |
| ------- | ---------------------------- | ---------- |
| Phase 4 | 配置 + 可观测性 + 退出码              | 先做，1–2 周   |
| Phase 5 | 批准流                          | 接着做，约 1 周  |
| Phase 6 | write_file + execute_command | 约 1–2 周    |
| Phase 7 | 多 Provider                   | 可选，约 1 周   |
| Phase 8 | 体验与分发                        | 最后收尾，约 1 周 |


Phase 4 和 5 顺序不建议对调：先有配置和可观测性，批准流和策略（如 `--approval`）接入会更清晰。Phase 7 若时间紧可延后，先完成 4→5→6→8 即可达到「可商用」最小闭环。

---

## 与现有文档的衔接

- 在 [00-initialization-plan.md](docs/ai/00-initialization-plan.md) 中可新增「Phase 4–8 总览」一节，并指向本学习计划。
- 每个 Phase 单独写 `docs/ai/plan-phase-N.md`（或在该总览中写子节），并按 [phase-implementation-sop.md](docs/ai/phase-implementation-sop.md) 写 Runbook `docs/ai/0N-phaseN-runbook.md`，更新 SOP 末尾的 Phase 索引。

---

## 总结

从「学习型闭环」到「可商用 CLI」的路径可以概括为：

1. **Phase 4**：配置与可观测性（商用基础）
2. **Phase 5**：用户批准流（安全基础）
3. **Phase 6**：写与执行工具（能力闭环）
4. **Phase 7**：多 Provider（可选，韧性）
5. **Phase 8**：CLI 体验与分发（可交付）

按上述顺序推进，并保持「先协议/类型后逻辑、可解释、每阶段有 DoD 与 Runbook」，即可在循序渐进中达成可商用的 Code Agent CLI。