# Phase 实现标准作业程序（SOP）

> 本文档约定实现任意 Phase（Phase 0、1、2、3 及后续 Phase n）时的标准步骤与产出，保证阶段间风格统一、可复盘、可验收。

---

## 1. 适用范围

- 在 [00-initialization-plan.md](00-initialization-plan.md) 中已定义或后续追加的每个 Phase。
- 新增能力、护栏、工具、Provider、CLI 选项等，凡属「一个可验收阶段」的，均按本 SOP 执行。

---

## 2. 实施流程总览

```text
1. 需求理解与方案（Plan） → 2. 开发实现（Code） → 3. 运行与验证说明（Runbook） → 4. 验收（DoD）
```

每个 Phase 必须完成上述四步，并留下对应文档与可执行验证。

---

## 3. 步骤一：需求理解与方案（Plan）

### 3.1 产出物

- **位置**：可在总览方案（如 `00-initialization-plan.md`）中新增一节，或单独建 `docs/ai/plan-phase-n.md`（若 Phase 较复杂）。
- **必须包含**：
  - **目标**：一句话说明本 Phase 要达成什么（例如「跑通真实 Agent Loop」「从能跑到可调试、可复盘」）。
  - **实现要点**：按执行顺序列出的 1、2、3… 条，每条可对应到具体文件/模块（如「在 `loop.ts` 中处理 tool_use → execute → tool_result」）。
  - **验收标准（DoD）**：可检查的条目列表（如「pnpm -r build 通过」「给出某任务可自主完成」）。

### 3.2 可选内容（建议）

- **现状分析**：当前相关模块状态 vs 本 Phase 变更点（表格形式更清晰）。
- **文件变更清单**：列出将修改/新增的文件及主要变更说明。
- **数据流/架构图**：若涉及多模块协作，用 mermaid 或表格说明数据流。

### 3.3 参考

- Phase 0～3 的「目标 + 实现要点 + 验收」见 [00-initialization-plan.md](00-initialization-plan.md) 第 6 节。
- Phase 3 的详细方案（现状分析、实现方案、数据流、文件清单、验收检查）可作复杂 Phase 的参考。

---

## 4. 步骤二：开发实现（Code）

### 4.1 原则

- **先协议/类型后逻辑**：新消息结构、新 policy 字段、新错误类型等先落类型与常量，再写实现。
- **可解释优先**：行为可在日志/transcript 中体现（如新护栏触发时写 meta、新指标写 diagnostics）。
- **不破坏既有 DoD**：新代码通过 `pnpm -r build` 与 `pnpm -r typecheck`，且不破坏已有 Phase 的验收。

### 4.2 建议顺序

1. 新增或扩展类型/错误/常量（如 `errors.ts`、`policy.ts`、`session` 类型）。
2. 实现核心逻辑（如 loop、provider、tools、session 方法）。
3. CLI/入口层集成（如新选项、transcript 字段、错误处理）。
4. 运行一次最小路径（如 `--provider mock --prompt "hello"`）确认无回归。

### 4.3 代码与文档对应

- Plan 中的「实现要点」应能在代码中一一对应（文件 + 职责清晰）。
- 新增配置项（如 policy 参数）建议在 Runbook 中列出默认值与含义。

### 4.4 代码的可阅读性
- 新增代码在关键模块增加中文注释（一看就懂的代码不要注释）

---

## 5. 步骤三：运行与验证说明（Runbook）

### 5.1 产出物

- **文件命名**：`docs/ai/NN-phaseN-runbook.md`，其中 `NN` 为两位数（01、02、03…），与 Phase 编号一致。
- **读者**：后续维护者与验收人，用于「如何跑、如何验证、原理是什么」。

### 5.2 必备章节结构

| 章节 | 说明 | 示例参考 |
|------|------|----------|
| **标题** | `Phase N 运行与验证说明（简短主题）` | 如「工具系统与 Agent Loop」「稳定性与可解释性增强」 |
| **核心原理回顾** | 本 Phase 涉及的概念/机制，用表格或短列表说明 | [02-phase2-runbook.md](02-phase2-runbook.md)、[03-phase3-runbook.md](03-phase3-runbook.md) 的「核心原理回顾」 |
| **运行方式** | 典型命令与场景（表格：场景 \| 命令） | 各 runbook 的「运行方式」 |
| **运行时日志（如适用）** | stderr 新增或重要日志格式说明 | Phase 2 的 `[tool]`、Phase 3 的 `[turn N] tools=...` |
| **成功路径验证** | 如何手动验证「正常情况」 | 单轮、多轮、带工具、长对话等 |
| **异常/失败路径验证（如适用）** | 错误、护栏、重试等行为的验证方式 | Phase 1 的缺 key、Phase 3 的空转终止与重试 |
| **安全/约束（如适用）** | 本 Phase 引入的安全或策略约束 | Phase 2 的路径与 8KB 限制 |
| **验收标准（DoD）** | 与 Plan 中 DoD 一致，可复制或细化为可执行清单 | 每条可判定通过/不通过 |

### 5.3 可选章节

- **策略参数**：若新增 policy/配置，用表格列出参数名、默认值、含义（见 Phase 3 runbook）。
- **Transcript 变更**：若 transcript 结构或字段有变，单独小节说明（如 Phase 3 的 result/meta）。
- **环境准备**：若本 Phase 依赖新环境（如新 env 变量、新依赖），在 Runbook 开头说明（见 Phase 1）。

---

## 6. 步骤四：验收（DoD）

### 6.1 执行方式

- **必做**：按 Plan 与 Runbook 中的 DoD 逐条检查（可人工或脚本）。
- **通用**：`pnpm -r build`、`pnpm -r typecheck` 通过；既有 Phase 的典型命令无回归。
- **本 Phase 特有条**：在 Runbook 的「验收标准（DoD）」中写明，并确保有对应「成功/异常路径验证」说明。

### 6.2 通过标准

- 所有 DoD 条目满足；
- 新增代码有对应 Runbook 说明，便于后续维护与排查。

---

## 7. Phase 实现检查清单（Checklist）

实现 Phase n 时，可按下表自检：

| # | 项目 | 说明 |
|---|------|------|
| 1 | Plan 已写 | 目标、实现要点、DoD 已定，复杂 Phase 含现状分析与文件清单 |
| 2 | 类型/错误/常量先行 | 新类型、错误类、policy 等已落盘再写逻辑 |
| 3 | 实现与 Plan 一致 | 每条实现要点有对应代码与文件 |
| 4 | 构建与类型检查通过 | `pnpm -r build`、`pnpm -r typecheck` 通过 |
| 5 | Runbook 已写 | `docs/ai/NN-phaseN-runbook.md` 存在且结构符合 5.2 |
| 6 | 成功路径可验证 | Runbook 中列出的典型命令与场景可跑通 |
| 7 | 异常路径可验证 | 若有护栏/错误/重试，Runbook 说明如何触发与预期行为 |
| 8 | DoD 全部满足 | Plan + Runbook 中的验收标准均已验证通过 |
| 9 | 无回归 | 已有 Phase 的 runbook 示例命令仍能按预期工作 |

---

## 8. 已有 Phase 文档索引

| Phase | 方案位置 | Runbook |
|-------|----------|---------|
| 0 | [00-initialization-plan.md](00-initialization-plan.md) § Phase 0 | —（地基阶段，无独立 runbook） |
| 1 | 同上 § Phase 1 | [01-phase1-runbook.md](01-phase1-runbook.md) |
| 2 | 同上 § Phase 2 | [02-phase2-runbook.md](02-phase2-runbook.md) |
| 3 | 同上 § Phase 3 | [03-phase3-runbook.md](03-phase3-runbook.md) |
| 4 | 同上 § Phase 4、[04-code-agent-commercial-plan.md](04-code-agent-commercial-plan.md) | [04-phase4-runbook.md](04-phase4-runbook.md) |
| 5 | [04-code-agent-commercial-plan.md](04-code-agent-commercial-plan.md) § Phase 5 | [05-phase5-runbook.md](05-phase5-runbook.md) |
| 6 | [04-code-agent-commercial-plan.md](04-code-agent-commercial-plan.md) § Phase 6、[plan-phase-6.md](plan-phase-6.md) | [06-phase6-runbook.md](06-phase6-runbook.md) |
| 7 | [04-code-agent-commercial-plan.md](04-code-agent-commercial-plan.md) § Phase 7 | [07-phase7-runbook.md](07-phase7-runbook.md) |
| 8 | [04-code-agent-commercial-plan.md](04-code-agent-commercial-plan.md) § Phase 8 | [08-phase8-runbook.md](08-phase8-runbook.md) |
| 9 | [09-cli-advanced-roadmap.md](09-cli-advanced-roadmap.md) § Phase 9、[plan-phase-9.md](plan-phase-9.md) | [09-phase9-runbook.md](09-phase9-runbook.md) |

后续新增 Phase n 时，在总览方案中增加对应 Phase 小节，并新增 `0n-phaseN-runbook.md`（n 为 Phase 编号），保持本索引更新。
