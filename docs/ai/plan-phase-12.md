# Phase 12 方案：Memory（会话内 + 跨会话持久化）

## 目标

在现有会话内消息历史基础上，按 [008-memory-prd.md](../issues/008-memory-prd.md) 实现**双机制**持久化记忆：

1. **CLAUDE.md**：用户撰写的指令与规则，多级作用域（项目 / 用户 / 本地），每会话加载并注入 system prompt。
2. **Auto Memory**：模型写入的学到的模式与经验，按项目存于 `~/.claude/projects/<project>/memory/`，仅 **MEMORY.md 前 200 行**每会话加载；主题文件按需由模型通过文件工具访问。

符合 [09-cli-advanced-roadmap.md](09-cli-advanced-roadmap.md) § Phase 12、[phase-implementation-sop.md](phase-implementation-sop.md) 与 PRD 核心原则（谁写谁用、上下文注入、体量控制）。

## 实现要点摘要

- **CLAUDE.md**：`findClaudeMdPaths(cwd)` 发现项目/用户/本地路径 → `loadClaudeMdContent` + `mergeAndTag` → 与 Skill 一起追加到 system prompt；支持 `claudeMdExcludes` 排除。
- **Auto Memory**：`getProjectId(cwd)`（优先 git 根 hash）→ `~/.claude/projects/<id>/memory/`；`getAutoMemoryFragment(projectId, 200)` 每轮 prepend 为一条 user 消息；`memory_write` 工具追加 MEMORY.md 或写主题 .md，需批准。
- **配置**：`autoMemoryEnabled`（默认 true）、`claudeMdExcludes`、`memoryPath`；CLI `--no-auto-memory`、`--claude-md-exclude`、`--memory-path`；环境变量 `MINI_AGENT_DISABLE_AUTO_MEMORY=1` 关闭 Auto Memory。
- **可观测性**：transcript 增加 `claudeMdLoaded`、`autoMemoryLoaded`；`--verbose` 打印 CLAUDE.md 与 Auto Memory 加载情况。

## 验收标准（DoD）

- CLAUDE.md：在项目或用户目录放置 CLAUDE.md 后启动，system prompt 中可见对应内容，transcript 体现 `claudeMdLoaded` 路径与来源；`claudeMdExcludes` 生效时对应路径不加载。
- Auto Memory：同一项目下连续两次运行，第一次通过 `memory_write` 写入 MEMORY.md，第二次启动时上下文中能看到 MEMORY.md 前 200 行（`[Memory: auto]` 片段）；关闭 `autoMemoryEnabled` 或 `MINI_AGENT_DISABLE_AUTO_MEMORY=1` 时不注入。
- 未配置/未启用时行为与当前一致；`pnpm -r build`、`pnpm -r typecheck` 通过；transcript 能区分 CLAUDE.md 与 Auto Memory；既有 Phase 典型命令无回归。

详细实现与数据流见 Phase 12 实现计划；Runbook 见 [12-phase12-runbook.md](12-phase12-runbook.md)。
