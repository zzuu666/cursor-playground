# Phase 12 运行与验证说明（Memory：CLAUDE.md + Auto Memory）

## 核心原理回顾

| 能力 | 核心原理 |
|------|----------|
| **CLAUDE.md** | 用户撰写的指令与规则；放置位置：项目 `./CLAUDE.md` 或 `./.claude/CLAUDE.md`、用户 `~/.claude/CLAUDE.md`、本地 `./CLAUDE.local.md`。每会话启动时发现并加载，合并后与 Skill 一起注入 system prompt，带 `[CLAUDE.md: project|user|local]` 来源标记。PRD 建议单文件 ≤200 行。 |
| **Auto Memory** | 模型写入的学到的模式与经验；存储于 `~/.claude/projects/<projectId>/memory/`，`<projectId>` 由 git 根或 cwd 派生。仅 **MEMORY.md 前 200 行**在每轮调用 LLM 前作为一条 user 消息 prepend 注入（`[Memory: auto]`）；主题文件（如 `debugging.md`）不预加载，由模型通过 `read_file` 等按需访问。 |
| **memory_write 工具** | 写入 Auto Memory：仅 `content` 时追加到 MEMORY.md；带 `topic` 时写入 `topic.md`。`requiresApproval: true`。 |
| **开关** | Auto Memory 默认开启；配置 `autoMemoryEnabled: false` 或 CLI `--no-auto-memory` 或环境变量 `MINI_AGENT_DISABLE_AUTO_MEMORY=1` 可关闭。 |

与 PRD 的对应：见 [008-memory-prd.md](../issues/008-memory-prd.md)；体量上 MEMORY.md 仅前 200 行加载，CLAUDE.md 建议 ≤200 行。

## 配置示例

`mini-agent.config.json`：

```json
{
  "autoMemoryEnabled": true,
  "claudeMdExcludes": ["some/other-team/path"],
  "memoryPath": "~/.my-claude"
}
```

- `memoryPath` 覆盖 Auto Memory 根目录（默认 `~/.claude`），即项目目录为 `<memoryPath>/projects/<projectId>/memory/`。

## 运行方式

| 场景 | 命令（示例） |
|------|----------------|
| 无 CLAUDE.md / 默认 Auto Memory | `mini-agent --provider mock --prompt "hello"` |
| 关闭 Auto Memory | `mini-agent --no-auto-memory --provider mock --prompt "hi"` 或 `MINI_AGENT_DISABLE_AUTO_MEMORY=1 mini-agent --prompt "hi"` |
| 排除部分 CLAUDE.md | `mini-agent --claude-md-exclude ./other/CLAUDE.md --prompt "hi"`（可多次） |
| 覆盖 Memory 根目录 | `mini-agent --memory-path /tmp/my-memory --prompt "hi"` |
| 验证 CLAUDE.md 加载 | 在 cwd 或 cwd/.claude 下放置 `CLAUDE.md`，运行 `mini-agent --verbose --provider mock --prompt "hi"`，stderr 应出现 `[verbose] claude-md loaded: ...` |
| 验证 Auto Memory 注入 | 第一次运行用 `memory_write` 写入一条内容（需批准），第二次运行同一项目，上下文中应出现 `[Memory: auto]` 及该内容。 |

## 成功路径验证

1. **CLAUDE.md**：在项目根或 `.claude/` 下放置 `CLAUDE.md`，启动后 system prompt 中可见其内容，且 transcript 的 `claudeMdLoaded` 含对应 path 与 source（project/user/local）；用户目录 `~/.claude/CLAUDE.md` 存在时同样被加载并标记为 user。
2. **Auto Memory**：同一项目下第一次运行中通过 `memory_write`（仅 content）追加到 MEMORY.md；第二次启动时，发给模型的 messages 首条或前部应包含 `[Memory: auto]` 及刚写入的内容；模型能据此回答。
3. **memory_write 主题文件**：调用 `memory_write` 时传入 `topic: "debugging"` 与 content，应在 `~/.claude/projects/<id>/memory/debugging.md` 写入；该文件不会在启动时注入，模型可通过 `read_file` 按需读取。
4. **关闭 Auto Memory**：使用 `--no-auto-memory` 或配置 `autoMemoryEnabled: false` 或 `MINI_AGENT_DISABLE_AUTO_MEMORY=1` 时，不注入 MEMORY.md 片段；transcript 的 `autoMemoryLoaded.enabled` 为 false。
5. **claudeMdExcludes**：配置或 CLI 指定排除路径/前缀后，对应 CLAUDE.md 不加载，transcript 中不出现该 path。

## 异常/失败路径验证

- CLAUDE.md 某文件读失败：该文件被跳过，不拖垮主流程。
- 无 git 时：项目 ID 由 cwd 路径 hash 派生，同一 cwd 多次运行仍共享同一 Auto Memory 目录。
- memory_write 未批准：与现有工具批准流一致，拒绝后模型收到拒绝说明。

## 安全/约束

- Auto Memory 目录与 CLAUDE.md 均为本地文件；memory_write 需用户批准，避免模型随意写入。
- 同一 git 仓库多 worktree 共享同一 Auto Memory 目录（按 git 根派生 projectId）。

## 验收标准（DoD）

- [ ] 在项目或用户目录放置 CLAUDE.md 后启动，system prompt 或首条上下文中可见对应内容，transcript 中能体现 `claudeMdLoaded` 路径与来源（project/user/local）；排除项 `claudeMdExcludes` 生效时对应路径不加载。
- [ ] 同一项目下连续两次运行：第一次通过 `memory_write` 写入 MEMORY.md（或主题文件），第二次启动时在发给模型的上下文中能看到 MEMORY.md 前 200 行内容（`[Memory: auto]` 片段），且模型能使用该信息；关闭 `autoMemoryEnabled` 或设置 `MINI_AGENT_DISABLE_AUTO_MEMORY=1` 时不注入。
- [ ] 未配置/未启用时行为与当前一致；`pnpm -r build`、`pnpm -r typecheck` 通过。
- [ ] Transcript 中能区分 CLAUDE.md 与 Auto Memory 的加载情况（`claudeMdLoaded`、`autoMemoryLoaded`）；Runbook 中成功/异常路径可执行；既有 Phase 典型命令无回归。

详细方案见 [plan-phase-12.md](plan-phase-12.md)；路线与 PRD 见 [09-cli-advanced-roadmap.md](09-cli-advanced-roadmap.md) § Phase 12、[008-memory-prd.md](../issues/008-memory-prd.md)。
