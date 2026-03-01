# Issue 003：maxTurns 触顶导致任务中断

## 现象

长任务（如「阅读项目代码，生成 README.md」）在多次读文件、写文件后报错：

```
[turn 12] tools=19, elapsed=25986ms
error: maxTurns exceeded: 12
```

即单次 run 内对话轮数达到 policy 中的 `maxTurns`（默认 12）后，Loop 直接抛错并退出，任务未完成。

## 根因

- `maxTurns` 是防止单次对话无限轮次的护栏，默认 12。
- 「读代码库 + 生成 README」需要多轮：每轮模型可能只发 1～2 个工具调用，加上压缩与总结，12 轮内往往不足以完成整库阅读 + 撰写。

## 处理建议

1. **通过配置提高上限**  
   在 `mini-agent.config.json` 或 `.mini-agent.json` 中增加 policy：
   ```json
   {
     "policy": {
       "maxTurns": 24
     }
   }
   ```

2. **默认值**  
   默认已从 12 调整为 20（`agent/policy.ts` 的 `DEFAULT_LOOP_POLICY.maxTurns`），以降低此类长任务触顶概率。若仍不够，可在配置中继续提高。

3. **与 maxToolCalls 的关系**  
   长任务可能先触顶 maxTurns 或 maxToolCalls，两者可同时在配置中调大。

## 相关

- Transcript 示例：`packages/cli/transcripts/2026-03-01T11-17-33-830Z.json`
- 策略定义：`packages/cli/src/agent/policy.ts`、`config.ts` 的 `policy.maxTurns`
