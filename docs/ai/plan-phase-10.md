# Phase 10 方案：Claude Code 式 Plugin 机制

## 目标

支持 Claude Code 风格的插件：以目录为单位，包含 manifest（`.claude-plugin/plugin.json`）及可选的 `skills/`、`agents/`、`hooks/` 等声明式内容；通过 `--plugin-dir` 或配置加载，将插件提供的 Skills 以命名空间形式并入现有 Skill 加载与 system prompt 构建，与 Phase 9 行为一致且可追溯来源。仅解析 JSON/目录结构，不执行插件内自定义 JS/TS 代码。

## 现状分析

| 模块 | 当前状态 | 本 Phase 变更 |
|------|----------|---------------|
| 配置 | `ConfigFile`/`ResolvedConfig` 无 `pluginDirs` | 新增 `pluginDirs?: string[]`，CLI 新增 `--plugin-dir` |
| Skill 加载 | Phase 9 已有 `loadSkills`、`loadGlobalSkillsFromRoot`、`buildSystemPrompt` | 新增「从插件目录发现 skills」路径，产出 `SkillEntry[]` 与现有结果合并 |
| 插件发现 | 无 | 新增插件解析：读 manifest、扫描 `skills/`，命名空间为 `plugin-name:skill-name` |
| Hooks/Agents/MCP | 无 | Phase 10 仅做结构约定与文档；实际解析与使用留到 Phase 11 或后续 |

## 实现要点

1. **Manifest 与插件契约**
   - 约定插件根目录下存在 `.claude-plugin/plugin.json`（或允许仅包含 `skills/` 的轻量插件，manifest 可选）。
   - Manifest 字段：`name`（必填，用作命名空间）、`description`、`version`、`author` 等；与 [Claude Code 文档](https://code.claude.com/docs/en/plugins) 对齐。
   - 仅解析 JSON，不执行插件内自定义 JS/TS 代码。
   - 新增类型：如 `PluginManifest`、`ResolvedPlugin`（path、name、skillEntries 等）。

2. **插件发现与加载方式**
   - 配置项增加 `pluginDirs?: string[]`（路径列表）；CLI 增加 `--plugin-dir <path>`，可多次使用，与配置合并（配置先，CLI 追加）。
   - 启动时按顺序解析每个插件目录：若存在 `.claude-plugin/plugin.json` 则读取并校验 `name`；若不存在 manifest 但存在 `skills/`，可视为匿名插件或跳过（由实现决定）。
   - 新增模块：如 `packages/cli/src/plugins/` 下 `manifest.ts`（解析 manifest）、`discover.ts`（从 pluginDirs 发现并加载各插件 skills）。

3. **Skills 集成（与 Phase 9 统一）**
   - 对每个已识别插件，扫描其根下 `skills/` 子目录，每个子目录内若有 `SKILL.md`（或约定 `skill.json`），则加载为一条 Skill；来源标记或 skill id 使用 `plugin-name:子目录名`（与 Claude Code 命名空间一致）。
   - 将上述 Skill 条目与现有 `loadSkills` / 全局 Skill 结果合并，统一进入 `buildSystemPrompt`，并在 transcript/verbose 中记录来源为插件及插件名。
   - 复用 `packages/cli/src/skills/load.ts` 中的单文件/目录加载逻辑（如 `loadOneFile`、`parseSkillMd`、`parseSkillJson`），或从插件根路径调用等价逻辑。

4. **可选：Hooks / Agents / Settings**
   - 若 Phase 10 包含 hooks：在插件根下读取 `hooks/hooks.json`，与现有（或新增）全局 hooks 配置合并，并在 Agent Loop 适当位置触发；格式与 Claude Code 文档一致。
   - `agents/`、`settings.json`、`.mcp.json` 在本 Phase 仅做结构约定与文档说明，实际解析与使用留到 Phase 11（MCP）或后续 TUI/Agent 阶段。

5. **可观测性与安全**
   - transcript 或 `--verbose` 中列出本次 run 加载的插件路径及 manifest name；文档注明插件以与 CLI 相同权限运行，用户应只加载可信插件。
   - 可选：在 `TranscriptPayload` 或 run meta 中增加 `pluginsLoaded: { path, name }[]`。

## 文件变更清单（建议）

| 文件 | 变更说明 |
|------|----------|
| `packages/cli/src/config.ts` | 增加 `pluginDirs` 到 `ConfigFile`、`ResolvedConfig`；`readConfigFile` 与 `loadConfig` 中解析、合并 `pluginDirs`；CLI 覆盖支持。 |
| `packages/cli/src/index.ts` | 增加 `--plugin-dir <path>` 选项（可多次），传入 `LoadConfigOptions.cli`；在构建 system prompt 前调用插件 discovery，将插件 skills 与现有 skillEntries 合并。 |
| `packages/cli/src/plugins/manifest.ts`（新建） | 读取并解析 `.claude-plugin/plugin.json`，返回 `PluginManifest`；校验 `name`。 |
| `packages/cli/src/plugins/discover.ts`（新建） | 接收 `pluginDirs`、cwd；对每个目录解析 manifest、扫描 `skills/`，返回 `ResolvedPlugin[]` 或 `SkillEntry[]`（带 plugin 命名空间）。 |
| `packages/cli/src/skills/load.ts` | 可选：抽出「从目录加载单条 skill」的共用函数，供 `plugins/discover` 复用。 |
| `docs/ai/10-phase10-runbook.md` | 运行与验证说明（见 Runbook 步骤）。 |

## 与 Phase 9 / Phase 11 的衔接

- **Phase 9**：继续负责「直接路径」的 Skill 加载（`skillPaths`、`--skill`、全局目录）；Phase 10 仅增加「从插件目录发现并加载 skills」的路径，两者在 **buildSystemPrompt 前** 汇总为同一 `SkillEntry[]`，统一用 `buildSystemPrompt`。
- **Phase 11（MCP）**：插件内 `.mcp.json` 在 Phase 10 仅作占位或读入配置不连接；Phase 11 可实现「MCP 配置可来自配置文件 + 已加载插件的 `.mcp.json`」。

## 验收标准（DoD）

- 给定一个符合约定的插件目录（含 `.claude-plugin/plugin.json` 与 `skills/hello/SKILL.md`），通过 `--plugin-dir ./that-plugin` 或配置 `pluginDirs` 加载后，system prompt 中可见该插件提供的 Skill 内容，且来源标记为 `plugin-name:hello`（或等价形式）；transcript/verbose 可体现已加载插件列表。
- 不指定任何插件时，行为与当前一致；与 Phase 9 的 `--skill` / `skillPaths` 并存时，插件 Skills 与直接指定 Skills 一并合并，无冲突。
- `pnpm -r build`、`pnpm -r typecheck` 通过；已有 Phase 典型命令无回归。

详细路线与依赖见 [09-cli-advanced-roadmap.md](09-cli-advanced-roadmap.md) § Phase 10。
