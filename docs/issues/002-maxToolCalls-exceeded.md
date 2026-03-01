# Issue 002：maxToolCalls 触顶导致任务中断

## 现象

长任务（如「阅读项目代码，生成 README.md」）在多轮读文件 + 写文件后报错：

```
[turn 8] tools=20, elapsed=5907ms
error: maxToolCalls exceeded: 20
```

即单次 run 内累计工具调用次数达到 policy 中的 `maxToolCalls`（默认 20）后，Loop 直接抛错并退出，任务未完成。

## 根因

- `maxToolCalls` 是防止单次对话无限调用工具的护栏，默认 20。
- 「读代码库 + 生成 README」类任务会先多次 `read_file` / `glob_search`，再 `write_file`，很容易在 8～10 轮内就超过 20 次调用。

## 处理建议

1. **通过配置提高上限**  
   在 `mini-agent.config.json` 或 `.mini-agent.json` 中增加 policy：
   ```json
   {
     "policy": {
       "maxToolCalls": 50
     }
   }
   ```
   或通过 CLI 传参（若后续支持 `--policy.maxToolCalls` 再在此补充）。

2. **默认值**  
   默认已从 20 调整为 40（`agent/policy.ts` 的 `DEFAULT_LOOP_POLICY.maxToolCalls`），以降低「读代码库 + 生成 README」等任务触顶概率。若仍不够，可在配置中继续提高。

3. **体验优化（可选）**  
   触顶时除抛错外，可考虑：写 transcript、在 stderr 提示「已达 maxToolCalls，可通过配置提高或简化任务」等，便于用户复现与调参。

## 相关

- Transcript 示例：`packages/cli/transcripts/2026-03-01T11-13-48-721Z.json`
- 策略定义：`packages/cli/src/agent/policy.ts`、`config.ts` 的 `policy.maxToolCalls`
