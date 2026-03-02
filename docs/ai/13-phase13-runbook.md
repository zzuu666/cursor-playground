# Phase 13 运行与验证说明（自动上下文压缩完备）

## 核心原理回顾

| 能力 | 核心原理 |
|------|----------|
| **Token 估算** | 轻量近似：约 4 字符/token，对当前轮发给 LLM 的 messages 统计字符后估算；每轮写入 diagnostics 与 `--verbose`。 |
| **触发策略** | `compressStrategy === "message_count"`：当 session 消息条数 > `summaryThreshold` 时触发压缩；`compressStrategy === "token_based"`：当估算 token > `contextMaxTokens` 时触发。保留 `summaryKeepRecent` 条最近消息，其余用摘要替换。 |
| **规则摘要** | 被移除消息的规则摘要：user 轮数、tool result 数、首条 user 意图前 200 字；插入为一条 user 消息并丢弃孤儿 tool_result。 |
| **LLM 摘要** | 当 `useLlmSummary: true` 时，压缩时先请求 LLM 对「待移除消息」生成一段简短摘要；超时或失败则回退到规则摘要。 |
| **压缩前写 Memory** | 当 `compressWriteMemory: true` 且 Auto Memory 启用时，压缩前将规则摘要以 `[Context compression <date>]: ...` 追加到当前项目 MEMORY.md。 |
| **可观测性** | transcript 的 `result.diagnostics` 每项含 `estimatedTokens`；`contextCompressEvents` 记录每次压缩的 atTurn、estimatedTokens、strategy（rule/llm）、memoryWritten。 |

与路线图对应：见 [09-cli-advanced-roadmap.md](09-cli-advanced-roadmap.md) § Phase 13。

## 策略参数

| 参数 | 默认值 | 含义 |
|------|--------|------|
| `contextMaxTokens` | 0 | 按 token 触发时的上限；0 表示不按 token 触发。 |
| `compressStrategy` | "message_count" | "message_count" 按条数触发；"token_based" 按估算 token 触发。 |
| `useLlmSummary` | false | 压缩时是否用 LLM 生成摘要（失败回退规则摘要）。 |
| `compressWriteMemory` | false | 压缩前是否将规则摘要写入 Auto Memory。 |
| `llmSummaryTimeoutMs` | 15000 | LLM 摘要请求超时（毫秒）。 |
| `llmSummaryMaxInputChars` | 50000 | 发给 LLM 摘要的输入最大字符数。 |
| `summaryThreshold` | 16 | 按条数触发时的消息数阈值。 |
| `summaryKeepRecent` | 8 | 压缩后保留的最近消息条数。 |

## 配置示例

`mini-agent.config.json`：

```json
{
  "policy": {
    "contextMaxTokens": 32000,
    "compressStrategy": "token_based",
    "useLlmSummary": false,
    "compressWriteMemory": true,
    "summaryThreshold": 16,
    "summaryKeepRecent": 8
  }
}
```

## 运行方式

| 场景 | 命令（示例） |
|------|----------------|
| 默认（仅按条数 + 规则摘要） | `mini-agent --provider mock --prompt "hello"` |
| 按 token 触发（阈值 8k） | `mini-agent --context-max-tokens 8000 --compress-strategy token_based --provider mock --prompt "..."` |
| 压缩前写 Memory | `mini-agent --compress-write-memory --provider mock --prompt "..."`（需 Auto Memory 启用） |
| 启用 LLM 摘要 | `mini-agent --use-llm-summary --provider <real> --prompt "..."`（失败自动回退规则摘要） |
| 查看 token 与压缩事件 | `mini-agent --verbose --prompt "..."`，stderr 出现 `[verbose] turn N ... estimated tokens: X` 及压缩时 `context compressed at turn N, strategy=...` |

## 运行时日志（stderr）

- `[verbose] turn N request: M messages, estimated tokens: X`：每轮请求消息数与估算 token。
- `[verbose] context compressed at turn N, strategy=rule|llm, memoryWritten=true|false`：当轮发生压缩时的策略与是否写入 Memory。

## 成功路径验证

1. **默认行为**：不配置 Phase 13 新项时，行为与 Phase 12 一致；仅按 `summaryThreshold` 条数触发规则摘要；transcript 的 diagnostics 含 `estimatedTokens`。
2. **按 token 触发**：配置 `compressStrategy: "token_based"`、`contextMaxTokens: 8000`，当估算 token 超过 8000 时触发压缩；对话可继续且无 2013 等错误。
3. **compressWriteMemory**：开启后，在触发压缩的轮次前将规则摘要追加到当前项目 MEMORY.md；下次会话通过 `[Memory: auto]` 可看到该段。
4. **useLlmSummary**：使用真实 provider 并开启后，压缩时先请求 LLM 摘要；若返回有效文本则用其作为摘要条；transcript 的 `contextCompressEvents` 中对应项 `strategy: "llm"`。
5. **verbose/transcript**：`--verbose` 下 stderr 可见每轮 estimated tokens；transcript 中 `result.diagnostics[].estimatedTokens` 与 `contextCompressEvents` 存在且一致。

## 异常/失败路径验证

- **LLM 摘要超时或失败**：自动回退到规则摘要；`contextCompressEvents` 中该次仍可记录为 `strategy: "llm"`（请求已发起），或实现时在回退时记为 `strategy: "rule"`（以实际写入的摘要为准）。当前实现：若 getSummary 抛错则 session 内 catch 并用 ruleSummary，loop 仍按 policy.useLlmSummary 记录 strategy，故可能为 "llm" 但实际为规则摘要；若需严格可后续在 session 返回实际使用的策略。
- **token_based 且 contextMaxTokens 未配置**：默认 0，不按 token 触发；仅 message_count 生效。
- **compressWriteMemory 但 Auto Memory 关闭**：index 不设置 onBeforeCompress，压缩不写 Memory。

## 安全/约束

- Token 估算为近似值，不同模型 tokenizer 不同，仅作触发与观测用。
- LLM 摘要会额外消耗一次 API 调用，且受 llmSummaryTimeoutMs、llmSummaryMaxInputChars 限制。
- 压缩前写 Memory 使用与现有 Auto Memory 相同路径与权限；仅追加文本，不执行代码。

## 验收标准（DoD）

- [ ] 当消息条数或估算 token 超过阈值时，自动触发压缩，对话可继续且不出现 2013 等协议错误。
- [ ] 若开启 LLM 摘要，压缩后上下文明显变短且语义可被模型延续；若 LLM 摘要失败或超时，自动回退到规则摘要。
- [ ] 若开启 compressWriteMemory，压缩前将规则摘要写入当前项目 Auto Memory（MEMORY.md），下次会话可通过现有 Memory 注入看到。
- [ ] `--verbose` 或 transcript 中可见 token 估算与压缩触发记录（estimatedTokens、strategy、memoryWritten）。
- [ ] `pnpm -r build`、`pnpm -r typecheck` 通过；未配置新项时行为与当前一致；既有 Phase 典型命令无回归。

方案见 [plan-phase-13.md](plan-phase-13.md)；路线见 [09-cli-advanced-roadmap.md](09-cli-advanced-roadmap.md) § Phase 13。
