# Phase 9 方案：Skill 加载机制

## 目标

从本地路径或配置指定路径加载 Skill 定义（SKILL.md 或 skill.json），将其内容合并进系统提示词，并在 transcript 与 verbose 中记录加载的 Skill 路径与摘要；不破坏现有可观测性，无 skill 配置时行为与当前一致。

## 实现要点

1. **Skill 来源与格式**：支持配置项 `skillPaths: string[]` 与 CLI `--skill <paths...>`；约定支持单文件 `SKILL.md`（Markdown + 可选 frontmatter）、`skill.json`（`description` / `systemPromptAddition`）；目录则扫描其下 `SKILL.md`、`skill.json` 并合并。
2. **与 system prompt 集成**：在入口处调用 `loadSkills` + `buildSystemPrompt`，将结果写入 `resolved.systemPrompt`，各 provider 使用该字段（有则用，无则用默认 `SYSTEM_PROMPT`）；每个 Skill 片段前加 `[Skill: path]` 来源标记。
3. **配置与 CLI**：`ConfigFile` / `ResolvedConfig` 增加 `skillPaths`；CLI `--skill` 可传多个路径，与配置合并顺序为「先配置后 CLI 追加」。
4. **可观测性**：`TranscriptPayload` 增加可选 `skillsLoaded: { path, charCount }[]`；`--verbose` 时 stderr 打印本次加载的 Skill 路径与字符数。

## 验收标准（DoD）

- 指定 `--skill <path>` 或配置 `skillPaths` 后，system prompt 中可见对应 Skill 内容，且 transcript 中能体现本次 run 加载了哪些 Skill（path + charCount）。
- 无 `--skill` 且配置无 `skillPaths` 时行为与当前一致。
- `pnpm -r build`、`pnpm -r typecheck` 通过；已有 Phase 典型命令无回归。

详细路线与依赖见 [09-cli-advanced-roadmap.md](09-cli-advanced-roadmap.md) § Phase 9。
