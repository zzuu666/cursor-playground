# Issue 007：Same tool repeated 与 transcript 字段脱敏

## 现象

1. **Same tool call repeated 3 times: execute_command**  
   在 git 等需要连续执行多条命令的场景下，agent 会多次调用 `execute_command`（如 `git status`、`git reset`、`git diff` 等）。原逻辑对「同一 (tool, input) 在整段历史中出现次数」做限制，导致同一轮或跨轮内「同一工具名 + 不同入参」的合法连续调用，也可能因历史中出现过相同命令 3 次而误判为 spin 并抛错。

2. **Transcript 中 sessionId、provider 被写成 `***`**  
   `writeTranscript` 使用 `redactObject(payload)` 对整份 payload 脱敏。其中：
   - `sessionId` 为 UUID，被 `isLikelyKeyValue` 判为「类密钥」而替换为 `***`；
   - 若存在对 `provider` 的脱敏逻辑或后续扩展，也会影响可读性。  
   二者为关联日志、排查问题所需，不应脱敏。

## 根因

- **重复检测**：`loop.ts` 中用 `recentFingerprints.filter((f) => f === fingerprint).length` 统计的是「历史中该 fingerprint 出现总次数」，而非「连续重复次数」。因此同一命令在不同轮次、中间穿插其他命令时，仍可能达到 3 次而触发误报。
- **脱敏**：`logger.ts` 的 `redactObject` 对长字符串且匹配类密钥模式的值统一替换；`writeTranscript` 未对顶层 `sessionId`、`provider` 做保留。

## 修复

1. **Same tool repeat（agent/loop.ts）**  
   - 改为仅检测**连续**重复：取最近 `maxSameToolRepeat - 1` 次调用的 fingerprint，若全部与当前 fingerprint 相同，再抛错。  
   - 这样只有「连续 N 次完全相同的 (tool, input)」才视为 spin，同一工具名、不同命令的连续调用不再误判。

2. **Transcript 保留 sessionId、provider（infra/logger.ts）**  
   - 在 `writeTranscript` 中，对 `redactObject(payload)` 得到的结果显式写回：
     - `safe.sessionId = payload.sessionId`
     - `safe.provider = payload.provider`  
   - 保证写入的 JSON 中二者为原始值，便于与 stderr、errors.jsonl 关联排查。

## 涉及文件

- `packages/cli/src/agent/loop.ts`：同一工具重复检测改为「仅连续重复」。
- `packages/cli/src/infra/logger.ts`：`writeTranscript` 中保留 `sessionId`、`provider` 不脱敏。

## 相关

- Transcript 示例：`packages/cli/transcripts/2026-03-01T17-25-50-655Z.json`
- 策略：`packages/cli/src/agent/policy.ts` 的 `maxSameToolRepeat`
