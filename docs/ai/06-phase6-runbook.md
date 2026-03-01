# Phase 6 运行与验证说明（写与执行工具）

## 核心原理回顾

| 能力 | 核心原理 |
|------|----------|
| write_file | 向工作目录内相对路径写入文件；路径经 `safe-path` 校验，禁止 `..` 及工作目录外路径。可选 `backup: true` 在覆盖前备份为 `{path}.bak`。标记 `requiresApproval: true`，在 `--approval prompt` 时需用户确认。 |
| execute_command | 在工作目录下执行 shell 命令；仅允许可执行名在白名单内（默认 npm、pnpm、node、npx、yarn、git、tsx、tsc）。可执行名取命令字符串第一个 token 的 basename（如 `npx tsc` → npx）。超时 60s，输出截断 32KB。标记 `requiresApproval: true`。 |
| 白名单配置 | 配置文件可选 `allowedCommands: string[]` 覆盖默认可执行名列表；不设则使用内置默认列表。 |
| 安全与审计 | 写/执行在 transcript 的 messages 中保留完整 tool_use 与 tool_result；批准/拒绝在 approvalLog 中记录；transcript 含 sessionId 与（若因错误终止）meta.error（name/message）；同时错误会写入独立 error 日志 `errors.jsonl`，便于审计与排查。 |

## 策略与参数

- **批准流**：与 Phase 5 一致。`write_file`、`execute_command` 均设 `requiresApproval: true`，在 `--approval prompt` 时会暂停并等待 y/n；`--approval never` 时直接拒绝并注入 tool_result；`--approval auto` 时直接执行。
- **execute_command 白名单**：默认 `npm, pnpm, node, npx, yarn, git, tsx, tsc`。配置文件示例：
  ```json
  { "allowedCommands": ["npm", "node", "npx", "git"] }
  ```

## 运行方式

从 `packages/cli` 或仓库根执行。Phase 6 新增工具 `write_file`、`execute_command`。

| 场景 | 命令（示例） |
|------|----------------|
| 单次 prompt，自动批准（写/执行会执行） | `pnpm exec tsx src/index.ts --provider mock --approval auto --prompt "write hello to test.txt"` |
| 需批准时等待用户确认 | `pnpm exec tsx src/index.ts --approval prompt --prompt "run npm install"`（需 TTY） |
| 禁止写/执行（仅读查） | `pnpm exec tsx src/index.ts --approval never --prompt "..."` |

## 运行时日志（stderr）

- 与 Phase 4/5 一致：带 **sessionId 前缀** 的 `[verbose]`、`[tool]`、`[turn N]`；批准时 `[approval] Approve tool "write_file"? (y/n or n <reason>): `。
- 工具执行成功：`[tool] write_file ok bytes=...`；拒绝或失败：`[tool] write_file error: ...`（错误信息会写入该行并脱敏）。
- 结束输出含 `sessionId=xxx` 与 `transcript=<path>`，便于用 sessionId 关联 transcript 与日志；错误时还会写入 `transcriptDir/errors.jsonl`（见 Phase 4 Runbook「Error 独立日志」）。

## 成功路径验证

- **write_file**：`--approval auto` 或 `--approval prompt` 且用户输入 y 时，应成功写入；若传 `backup: true` 且文件已存在，应先生成 `.bak` 再写入。路径含 `..` 或超出工作目录时应返回错误 tool_result。
- **execute_command**：白名单内命令（如 `npm -v`、`node -e "console.log(1)"`）在批准后应执行并返回输出；输出超过 32KB 时应截断并带 `(truncated: output limit exceeded)`。
- **白名单拒绝**：如 `execute_command` 传入 `command: "rm -rf /"`，可执行名为 `rm`，不在白名单，应返回 `Command not allowed: "rm" is not in the allowlist...`。

## 异常/失败路径验证

- **--approval never**：调用 write_file 或 execute_command 时，不执行并注入「策略为 never，请求被拒绝」类 tool_result，模型可继续；approvalLog 记 rejected。
- **路径越权**：write_file 的 path 为 `../../../etc/passwd` 或绝对路径超出 cwd 时，应返回 path must be inside workspace 类错误。
- **超时**：execute_command 执行超过 60s 时，应终止并返回带 `(command timed out)` 的 stderr 摘要。

## 安全/约束

- 写文件仅限工作目录内；禁止 `..` 与工作目录外绝对路径。
- 执行命令仅限白名单可执行名；禁止直接 `rm`、`curl | sh` 等未列入白名单的命令。
- 所有写/执行在 transcript 的 messages 与 approvalLog 中可审计；批准流与 Phase 5 一致。
- **Transcript 与错误**：每条 transcript 含 `sessionId`；若因 maxTurns/maxToolCalls 等错误终止，`meta.error` 会记录 `{ name, message }`，同时向 `errors.jsonl` 追加一条独立记录，便于复盘与全局查错（见 Phase 4 Runbook「Transcript 变更」与「Error 独立日志」）。

## 验收标准（DoD）

- `pnpm -r build`、`pnpm -r typecheck` 通过。
- 在批准流开启（`--approval prompt`）时，write_file / execute_command 会触发确认；拒绝后模型可继续。
- 路径与命令白名单生效：路径逃逸、非白名单命令请求被拒绝并返回清晰 tool_result。
- Transcript 可审计：messages 含写/执行的 tool_use 与 tool_result，approvalLog 含批准/拒绝记录。
- 无回归：Phase 1–5 的典型命令（如 `--provider mock --prompt "hi"`）仍能按预期工作。
