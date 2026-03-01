# Phase 10 运行与验证说明（Claude Code 式 Plugin 机制）

## 核心原理回顾

| 能力 | 核心原理 |
|------|----------|
| Plugin 定义 | 插件 = **目录**，内含 manifest（`.claude-plugin/plugin.json`）及可选的 `skills/`、`agents/`、`hooks/` 等；参考 [Claude Code - Create plugins](https://code.claude.com/docs/en/plugins)。仅解析 JSON 与目录结构，**不执行**插件内自定义 JS/TS 代码。 |
| Manifest | `.claude-plugin/plugin.json` 必含 `name`（命名空间）；可选 `description`、`version`、`author`。`name` 用于 Skill 来源标记，如 `plugin-name:hello`。 |
| 加载方式 | 配置项 `pluginDirs?: string[]` 与 CLI `--plugin-dir <path>`（可多次）；合并顺序为配置先、CLI 追加。启动时按顺序解析每个插件目录，读 manifest、扫描 `skills/`。 |
| Skills 集成 | 每个插件根下 `skills/<子目录名>/SKILL.md`（或 `skill.json`）加载为一条 Skill，来源标记为 `plugin-name:子目录名`。与 Phase 9 的 `loadSkills` / 全局 Skill 结果合并后统一进入 `buildSystemPrompt`。 |
| 可观测性 | transcript 或 `--verbose` 中列出本次 run 加载的插件路径及 manifest name；可选 `pluginsLoaded: { path, name }[]`。 |

## 插件目录结构约定

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json      # name, description, version, author
└── skills/
    └── hello/
        └── SKILL.md     # 对应 skill 名为 plugin-name:hello
```

- 仅 `plugin.json` 放在 `.claude-plugin/` 内；`skills/`、`agents/`、`hooks/` 等均在插件**根目录**下。
- 轻量插件可仅含 `skills/` 而无 manifest（由实现决定是否支持匿名插件或要求必有 manifest）。

## 运行方式

从仓库根或 `packages/cli` 执行；插件路径相对于当前工作目录解析。

| 场景 | 命令（示例） |
|------|----------------|
| 无插件（与当前一致） | `mini-agent --provider mock --prompt "hello"` |
| 单插件（CLI） | `mini-agent --provider mock --plugin-dir ./my-plugin --prompt "hi"` |
| 多插件（CLI） | `mini-agent --provider mock --plugin-dir ./plugin-a --plugin-dir ./plugin-b --prompt "hi"` |
| 配置 + verbose | 在 `mini-agent.config.json` 中设置 `"pluginDirs": ["./plugins/my-plugin"]`，运行 `mini-agent --verbose --prompt "hi"`，stderr 应出现已加载插件列表。 |
| 插件 Skills 与 --skill 并存 | `mini-agent --provider mock --plugin-dir ./my-plugin --skill ./local/SKILL.md --prompt "hi"`，system prompt 中应同时包含插件 skill（如 `my-plugin:hello`）与本地 skill 内容。 |

## 成功路径验证

1. **无插件**：不传 `--plugin-dir`、配置无 `pluginDirs` 时，行为与 Phase 9 一致，无插件相关日志。
2. **单插件**：准备符合约定的插件目录（含 `.claude-plugin/plugin.json` 与 `skills/hello/SKILL.md`），执行 `mini-agent --provider mock --plugin-dir ./that-plugin --prompt "say hi"`；transcript/verbose 中应体现已加载插件（路径与 name）；system prompt 中应包含该插件 skill 内容，来源标记为 `plugin-name:hello`（或等价形式）。
3. **多插件**：使用多个 `--plugin-dir` 或配置中多个 `pluginDirs`，各插件 skills 按加载顺序合并进 system prompt，来源标记分别带各自 `name`。
4. **与 Phase 9 并存**：同时使用 `--plugin-dir` 与 `--skill`（或 `skillPaths`），插件 Skills 与直接指定 Skills 一并合并，无冲突；transcript 中可区分来源（插件 vs 直接路径）。
5. **Verbose**：`--verbose` 且本次加载了插件时，stderr 在合适位置出现已加载插件列表（路径及 manifest name）。

## 异常/失败路径验证（如适用）

- 插件路径不存在或不可读：该路径被跳过或报错（由实现决定），不拖垮主流程。
- 无 manifest 且实现要求必有：该目录不视为有效插件，跳过；或视为匿名插件仅扫描 `skills/`（由实现决定）。
- manifest 中缺少 `name`：该插件加载失败并记录错误，或跳过。
- 插件内无 `skills/` 或 `skills/` 下无有效 SKILL 文件：该插件仍视为已加载（manifest 有效），仅无 skill 注入；transcript/verbose 仍可列出该插件。

## 安全/约束

- 插件以与 CLI 相同权限运行；用户仅应加载可信插件。不在本 Phase 实现沙箱或签名校验；可选列为后续扩展。
- 插件目录内不执行自定义 JS/TS 入口，仅读取 manifest 与约定文件（SKILL.md、hooks.json 等），降低恶意代码执行风险。

## 验收标准（DoD）

- [ ] 给定符合约定的插件目录（含 `.claude-plugin/plugin.json` 与 `skills/hello/SKILL.md`），通过 `--plugin-dir ./that-plugin` 或配置 `pluginDirs` 加载后，system prompt 中可见该插件提供的 Skill 内容，且来源标记为 `plugin-name:hello`（或等价形式）；transcript/verbose 可体现已加载插件列表。
- [ ] 不指定任何插件时，行为与当前一致。
- [ ] 与 Phase 9 的 `--skill` / `skillPaths` 并存时，插件 Skills 与直接指定 Skills 一并合并，无冲突。
- [ ] `pnpm -r build`、`pnpm -r typecheck` 通过。
- [ ] 已有 Phase 的典型命令无回归。
- [ ] Runbook 中列出的成功路径与 verbose 示例可跑通。

详细方案见 [plan-phase-10.md](plan-phase-10.md)；路线与依赖见 [09-cli-advanced-roadmap.md](09-cli-advanced-roadmap.md) § Phase 10。
