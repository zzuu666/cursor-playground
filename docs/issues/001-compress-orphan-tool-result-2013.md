# Issue 001：压缩后孤儿 tool_result 导致 API 2013 报错

## 现象

长对话多轮工具调用后出现：

```
[turn 6] tools=10, elapsed=2949ms
error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"invalid params, tool result's tool id(call_function_xxx) not found (2013)"},"request_id":"..."}
```

即上游 API（MiniMax/Anthropic 兼容）返回 **2013**：请求体中存在某个 `tool_result` 的 `tool_use_id`，但在本次请求的消息历史里**找不到**对应的 `tool_use` 块。

## 根因

出在 **Session 压缩**（`compressToSummary`）的逻辑：

- 当 `messages.length > summaryThreshold` 时，会从**头部**删除 `messages.length - summaryKeepRecent` 条消息，再在头部插入一条摘要。
- 删除是按「条数」删的，没有按「对话结构」考虑。典型结构是：
  - 1 条 assistant（含多个 `tool_use`，每个有唯一 id）
  - 紧跟多条 user，每条一个 `tool_result`，`tool_use_id` 对应上面的 id
- 若删除区间刚好把某条 **assistant（含 tool_use A、B）** 删掉，却只删了部分紧跟的 user（例如只删了 result A，留下了 result B），则剩余消息里会出现：
  - **没有** id 为 B 的 `tool_use`
  - **仍有** `tool_result` 的 `tool_use_id: B`
- 发给 API 时就会报：tool id B not found (2013)。

也就是说：压缩产生了**孤儿** `tool_result`（其 `tool_use_id` 在保留的 assistant 消息中已不存在）。

## 修复

**文件**：`packages/cli/src/agent/session.ts`

1. **收集当前消息中所有 tool_use 的 id**  
   新增私有方法 `toolUseIdsInMessages(messages)`，遍历所有 assistant 的 content，收集 `type === "tool_use"` 的 `id`，得到集合 `allowedIds`。

2. **压缩后丢弃孤儿 tool_result**  
   在 `compressToSummary` 完成「按条数删除 + 插入摘要」之后：
   - 从紧跟摘要的下一条消息开始检查；
   - 若该条是 **user** 且 content **全是** `tool_result`，且这些 `tool_result` 的 `tool_use_id` **都不在** `allowedIds` 里，则视作孤儿，**整条 user 消息删除**；
   - 重复直到第一条不再是此类孤儿消息为止。

保证发给 API 的请求中，每个 `tool_result` 都有对应的 `tool_use`，从而消除 2013。

## 相关

- Transcript 示例：`packages/cli/transcripts/2026-03-01T11-07-43-491Z.json`（压缩后可见摘要 + 仅含 tool_result 的 user 块）。
- 策略参数：`summaryThreshold`、`summaryKeepRecent`（见 `agent/policy.ts` 与 Phase 3 Runbook）。
