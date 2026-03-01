# Mini Agent — 0 到 1 初始化方案（学习优先）

> 目标：从底层机制出发，亲手实现一个最小可运行的 Code Agent。  
> 范围：先做对“原理理解”最关键的能力，不追求一开始就对标 Claude Code。

---

## 1. 项目定位与阶段目标

### 1.1 项目定位

这是一个 **学习型工程**，核心不是“功能多”，而是“每一步都能解释清楚为什么这样设计”。

### 1.2 第一性目标（必须先完成）

实现并跑通这条闭环：

`用户输入 -> LLM -> tool_use -> 本地执行工具 -> tool_result -> LLM -> 最终回答`

只要这条链路稳定，后续能力（UI、更多工具、自动化）都只是增量扩展。

### 1.3 非目标（第一版不做）

- 不追求完整 IDE 级体验
- 不追求大量工具
- 不追求复杂多 Agent 协作
- 不追求“全自动高权限执行”

---

## 2. 核心原理（Agent Loop）

Code Agent 的本质是一个循环：

1. 把系统提示词、历史消息、可用工具描述发给 LLM
2. 解析 LLM 响应  
   - 若是 `text`：输出给用户  
   - 若是 `tool_use`：执行工具并生成 `tool_result` 回填历史
3. 重复第 1-2 步，直到没有新的工具调用

这就是最小“感知-思考-行动”闭环。

**关键原则：**

- 每轮都保留完整 assistant content blocks（text/tool_use/thinking），避免推理链断裂
- 工具执行必须结构化返回（成功/失败/耗时/截断信息）
- Loop 必须有护栏（最大轮数、最大工具调用数、超时）

---

## 3. 技术选型（学习与实现平衡）

| 项目 | 选择 | 理由 |
|------|------|------|
| 语言 | TypeScript | 类型约束强，便于理解消息协议和工具接口 |
| 运行时 | Node.js 22 (nvm) | 稳定、现代 ESM 支持 |
| 包管理 | pnpm + workspace | monorepo 成本低，后续可扩展多包 |
| LLM Provider | MiniMax 海外版（Anthropic 兼容） | 支持 tool_use + stream，足够学习 |
| LLM SDK | `@anthropic-ai/sdk` | 直接复用成熟协议实现 |
| CLI | `commander` | 参数清晰，学习成本低 |
| 最小 UI | 先纯 stdout/stderr | 先验证循环，再引入 Ink |

---

## 4. Monorepo 结构（pnpm workspace）

> 初始化即使用 monorepo，实际 CLI 工程放在 `packages/cli`。

```text
mini-agent/
├── .nvmrc
├── package.json                 # workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── docs/
│   └── ai/
│       └── 00-initialization-plan.md
├── packages/
│   └── cli/
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts         # CLI 入口
│       │   ├── agent/
│       │   │   ├── loop.ts      # Agent Loop
│       │   │   ├── session.ts   # 历史消息管理
│       │   │   └── policy.ts    # loop 护栏与执行策略
│       │   ├── providers/
│       │   │   ├── base.ts      # Provider 抽象
│       │   │   └── anthropic.ts # MiniMax 实现
│       │   ├── tools/
│       │   │   ├── types.ts
│       │   │   ├── registry.ts
│       │   │   ├── read-file.ts
│       │   │   └── glob-search.ts
│       │   ├── prompts/
│       │   │   └── system.ts
│       │   └── infra/
│       │       ├── logger.ts    # 结构化日志/transcript
│       │       └── errors.ts
│       └── transcripts/         # 会话回放日志（本地）
└── scripts/
    └── dev.sh
```

---

## 5. 依赖建议（第一版最小集合）

### 5.1 `packages/cli` 运行时依赖

- `@anthropic-ai/sdk`
- `commander`
- `glob`
- `zod`（工具参数校验，强烈建议）

### 5.2 `packages/cli` 开发依赖

- `typescript`
- `tsx`
- `@types/node`

> 第一版先不引入 Ink/chalk/ora，减少干扰。等闭环稳定后再叠加交互体验层。

---

## 6. 分阶段实施路线（学习版）

## Phase 0 — 工程与协议地基

**目标：** monorepo 跑起来，消息模型和约束先定清楚。

1. 初始化 pnpm workspace（root + `packages/cli`）
2. 完成 TypeScript 配置（root base + cli 子配置）
3. 定义统一消息类型（user/assistant/tool_use/tool_result）
4. 定义 Loop 护栏参数：
   - `maxTurns`（建议 12）
   - `maxToolCalls`（建议 20）
   - `toolTimeoutMs`（建议 15_000）
5. 增加结构化日志与 transcript 落盘

**验收（DoD）：**

- `pnpm -r build` 通过
- CLI 可启动并接收一条输入
- 能写入一份最小 transcript（包含输入与模型输出）

---

## Phase 1 — 纯对话闭环（无工具）

**目标：** 验证 Provider、流式输出、会话历史。

1. 接入 MiniMax（Anthropic SDK + baseURL）
2. 实现单轮与多轮对话（含 REPL）
3. 实现 stream 输出（`--stream`）
4. 保存完整 assistant content blocks
5. API Key 安全：`.env` + 环境变量，transcript/日志脱敏

**验收（DoD）：**

- 连续多轮问答上下文不丢失（REPL 模式）
- stream 中断时能返回可读错误
- transcript 可回放每一轮请求/响应摘要，且不含明文 key

**运行与验证：** 见 [01-phase1-runbook.md](01-phase1-runbook.md)；自动化验收执行 `./scripts/phase1-verify.sh`。

---

## Phase 2 — 单工具到双工具（核心学习阶段）

**目标：** 跑通真实 Agent Loop，理解 tool_use/tool_result 协议。

1. 实现 Tool 抽象与 Registry（[tools/types.ts](packages/cli/src/tools/types.ts)、[registry.ts](packages/cli/src/tools/registry.ts)）
2. 接入 `read_file`（[read-file.ts](packages/cli/src/tools/read-file.ts)）
3. 接入 `glob_search`（[glob-search.ts](packages/cli/src/tools/glob-search.ts)）
4. 在 Loop 中处理 `tool_use -> execute -> tool_result -> continue`；Provider 请求中传入 tools（[loop.ts](packages/cli/src/agent/loop.ts)、[anthropic.ts](packages/cli/src/providers/anthropic.ts)）
5. 安全约束：工作目录内路径（[safe-path.ts](packages/cli/src/tools/safe-path.ts)）、输出 8KB 上限

**验收（DoD）：**

- 给出“读取某文件并总结”任务可自主完成
- 给出“搜索某类文件并汇总”任务可自主完成
- 工具失败（文件不存在/超时）可被模型消费并继续推进

**运行与原理：** 见 [02-phase2-runbook.md](02-phase2-runbook.md)。

---

## Phase 3 — 稳定性与可解释性增强

**目标：** 从“能跑”升级到“可调试、可复盘”。

1. 增加重试策略（仅对可重试错误）
2. 增加空转检测（重复同一工具调用 N 次即终止）
3. 增加会话摘要（长对话压缩）
4. 为每轮输出诊断信息（turn、tool count、耗时）

**验收（DoD）：**

- 异常场景有稳定退出路径，不会无限循环
- 长对话时上下文控制稳定，不出现明显失忆
- 任意一段会话可基于 transcript 复盘

---

## 7. 与“可用型 Agent”的边界

当前方案是学习最优路径，不是生产最优路径。以下能力明确后置：

- `write-file`、`execute-command`（高风险操作）
- 用户批准流（approve/deny）
- 更复杂 TUI（Ink）
- 多 Provider 适配与降级矩阵

等学习闭环稳定后再进入“能力拓展阶段”。

---

## 8. 关键设计约束（必须遵守）

1. **先协议后功能**：先把消息结构跑顺，再加工具
2. **先可解释后炫技**：所有行为都要能在日志中说明白
3. **先小工具后高权限**：先读和查，再写和执行
4. **先稳定后体验**：先命令行文本输出，再做 Ink UI

---

## 9. 学习收益映射

| 阶段 | 你会真正掌握什么 |
|------|------------------|
| Phase 0 | workspace 工程组织、消息模型、Loop 约束设计 |
| Phase 1 | LLM API 协议、streaming、多轮上下文管理 |
| Phase 2 | tool_use/tool_result 机制、Agent Loop 核心实现 |
| Phase 3 | 稳定性治理、可观测性、会话复盘方法 |

---

## 10. 下一步执行清单（立即可做）

1. 初始化 workspace（root + `packages/cli`）
2. 创建 `providers/base.ts` 与 `anthropic.ts`
3. 写最小 `loop.ts`（先无工具）
4. 接入 `read-file` 工具并跑通首个端到端任务
