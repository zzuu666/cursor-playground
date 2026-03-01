# Phase 2 运行与验证说明（工具系统与 Agent Loop）

## 核心原理回顾

| 步骤 | 核心原理 |
|------|----------|
| Tool + Registry | 工具 = 可被模型按名调用的“函数”；Registry 负责从声明到实现的映射。 |
| read_file | 只读工具：输入来自 LLM 的 JSON，需 schema 校验与路径约束；输出为字符串塞入 tool_result。 |
| glob_search | 探索类工具：同样输入/输出契约，结果需序列化并可选截断。 |
| Provider + Loop | 请求里传 tools 模型才会返回 tool_use；Loop 解析 tool_use → 执行 → addToolResult → 再调 LLM，形成闭环。 |
| 安全 | 最小边界：工作目录限制 + 输出长度上限（8KB）。 |

## 运行方式

与 Phase 1 相同，从 `packages/cli` 或仓库根执行。**使用 minimax provider 时**会自动带上 `read_file` 与 `glob_search`，模型可自主调用。

| 场景 | 命令（示例） |
|------|----------------|
| 读文件并总结 | `pnpm exec tsx src/index.ts --prompt "读取 package.json 并列出前 3 个依赖"` |
| 搜索文件并汇总 | `pnpm exec tsx src/index.ts --prompt "列出所有 .ts 文件路径"` |
| Mock（无工具） | `pnpm exec tsx src/index.ts --provider mock --prompt "hello"`（不传 tools，无 tool_use） |

## 运行时日志（stderr）

以下日志统一输出到 **stderr**，stdout 仅保留模型回复与 `turns=...`、`transcript=...` 等最终输出，便于管道与重定向（例如 `2> agent.log` 单独保存日志）。

- **流式状态**：使用 `--stream` 时，每轮 LLM 开始/结束会向 stderr 输出 `[stream] turn N start`、`[stream] turn N end`，便于区分正在流式输出与本轮结束。
- **Tool call**：每次工具执行会在 stderr 输出两行：`[tool] <name> input: <入参摘要>` 与 `[tool] <name> ok N bytes` 或 `[tool] <name> error: <错误摘要>`，便于调试与学习 Agent 行为。

## 成功路径验证

- **读文件任务**：如“读取 package.json 并总结依赖”，模型应发出 `read_file`，拿到内容后回复；transcript 中可见 tool_use 与 tool_result。
- **搜索任务**：如“列出 src 下所有 .ts 文件”，模型应发出 `glob_search`，拿到列表后回复。
- **失败被消费**：如“读取不存在的文件 xyz.txt”，工具返回错误信息、isError=true，模型应能基于 tool_result 回复（如道歉或建议）。
- **日志**：开启 `--stream` 或触发工具时，stderr 上能看到对应的 `[stream] turn N start/end` 与 `[tool] <name> input: ...` / `ok N bytes` 或 `error: ...`。

## 安全约束（Phase 2）

- 路径仅允许工作目录内（`resolveWithinCwd` 拒绝 `..` 与越界绝对路径）。
- 单次工具输出上限 8KB，超出截断并注明 `(truncated)`。
- `glob_search` 的 pattern 不得含 `..`。

## 验收标准（DoD）

- `pnpm -r build` 与 `pnpm -r typecheck` 通过。
- “读取某文件并总结”由模型自主调用 read_file 并完成。
- “搜索某类文件并汇总”由模型自主调用 glob_search 并完成。
- 文件不存在或越界路径时，工具返回错误信息，模型能基于 tool_result 继续回复。
- 使用 `--stream` 或触发工具时，stderr 上能看到对应的 `[stream]` / `[tool]` 日志行。
