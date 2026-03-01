# Phase 9 运行与验证说明（Skill 加载机制）

## 核心原理回顾

| 能力 | 核心原理 |
|------|----------|
| Skill 来源 | **全局**：默认从 `~/.agents/skills`、`~/.cursor/skills` 按子目录发现（每个子目录一个 skill，其内 `SKILL.md` 或 `skill.json`）。**项目**：配置项 `skillPaths`（JSON 数组）与 CLI `--skill <paths...>`。合并顺序为「先全局（.agents → .cursor）→ 配置 skillPaths → CLI 追加」。 |
| 格式 | 单文件：`.md` 按 SKILL.md 解析（可选 YAML frontmatter + body）；`.json` 按 skill.json 解析（`systemPromptAddition` / `description`）。目录：扫描其下 `SKILL.md`、`skill.json` 逐个加载。全局根目录下为「子目录 = 一个 skill」，子目录内再放 `SKILL.md` 或 `skill.json`。 |
| System 注入 | 入口在 loadConfig 后调用 `loadAllGlobalSkills`（若未 skip）+ `loadSkills` → `buildSystemPrompt`，得到「默认 SYSTEM_PROMPT + [Skill: path] + content」拼接串，写入 `resolved.systemPrompt`；各 provider 使用该字段（有则用，无则用默认）。 |
| 可观测性 | transcript 增加可选 `skillsLoaded: { path, charCount }[]`；全局 skill 的 path 带来源前缀如 `agents:git-commit`、`cursor:frontend-code-review`；`--verbose` 时 stderr 打印 `[verbose] skills loaded: path1 (N chars), ...`。 |

## 运行方式

从仓库根或 `packages/cli` 执行；路径相对于当前工作目录解析。

| 场景 | 命令（示例） |
|------|----------------|
| 无 Skill（与之前一致） | `mini-agent --provider mock --prompt "hello"` |
| 单文件 Skill（CLI） | `mini-agent --provider mock --skill ./path/to/SKILL.md --prompt "hello"` |
| 多路径（CLI） | `mini-agent --provider mock --skill ./skill1.md ./skill2 --prompt "hi"` |
| 目录（扫描 SKILL.md / skill.json） | `mini-agent --provider mock --skill ./my-skills-dir --prompt "hi"` |
| 配置 + verbose | 在 `mini-agent.config.json` 中设置 `"skillPaths": ["./skills"]`，运行 `mini-agent --verbose --prompt "hi"`，stderr 应出现 `[verbose] skills loaded: ...` |
| dry-run 看 Skill 摘要 | `mini-agent --provider mock --skill ./SKILL.md --dry-run --prompt "x"`，stderr 应出现 `[dry-run] skills: ... (N chars)` |
| 仅用全局 Skills（无 --skill/无 skillPaths） | 在 `~/.agents/skills/git-commit/SKILL.md` 或 `~/.cursor/skills/...` 存在时，直接运行 `mini-agent --provider mock --verbose --prompt "hi"`，stderr 应出现 `[verbose] skills loaded: agents:git-commit (N chars), ...` 或 `cursor:...` |
| 关闭全局 Skills | 配置 `"skipGlobalSkills": true` 或环境变量 `MINI_AGENT_SKIP_GLOBAL_SKILLS=1`，则不再从 `~/.agents/skills`、`~/.cursor/skills` 加载 |

## 全局 Skills

- **默认路径**：`~/.agents/skills`、`~/.cursor/skills`（先 .agents 后 .cursor）。每个根目录下**子目录**代表一个 skill，子目录内需有 `SKILL.md` 或 `skill.json`。
- **合并顺序**：全局（.agents → .cursor）→ 配置 `skillPaths` → CLI `--skill`；后加载的同名或同用途 skill 可覆盖前面的。
- **配置**：`globalSkillDirs?: string[]` 覆盖默认根目录列表（完全替换）；`skipGlobalSkills?: boolean` 关闭全局加载。环境变量：`GLOBAL_SKILLS_DIRS` 逗号分隔多个路径；`MINI_AGENT_SKIP_GLOBAL_SKILLS=1` 关闭全局。
- **Transcript 中的 path**：全局 skill 的 path 带来源前缀，如 `agents:git-commit`、`cursor:frontend-code-review`，便于区分来自哪一全局根。
- **验证**：在 `~/.agents/skills/git-commit/` 下放置 `SKILL.md` 后，运行 `mini-agent --provider mock --verbose --prompt "hi"`，stderr 应出现 `[verbose] skills loaded: agents:git-commit (N chars)`，transcript 的 `skillsLoaded` 中含该条。

## 成功路径验证

1. **无 Skill**：`mini-agent --provider mock --prompt "hello"` 行为与 Phase 8 一致，无 skill 相关日志，transcript 无 `skillsLoaded`。
2. **单文件**：准备一个 `SKILL.md`（如仅含 `You prefer concise answers.`），执行 `mini-agent --provider mock --skill ./SKILL.md --prompt "say hi"`，transcript 中 `skillsLoaded` 含该路径与 charCount；若用真实 provider，模型回复应体现 Skill 内容。
3. **目录**：在目录内放置 `SKILL.md` 或 `skill.json`，`--skill ./that-dir` 后 transcript 中应出现该目录下被扫描到的文件路径。
4. **Verbose**：`--verbose` 且本次加载了 Skill 时，stderr 在首轮前出现一行 `[verbose] skills loaded: path1 (N chars), ...`。
5. **配置 + CLI 合并**：配置中 `skillPaths: ["./a"]`，CLI 再传 `--skill ./b`，最终应加载 a 与 b（先 a 后 b）。
6. **全局 Skills**：在 `~/.agents/skills/git-commit/` 下放置 `SKILL.md`（或 `~/.cursor/skills/` 下），不传 `--skill`、不配 `skillPaths`，运行后 transcript 中 `skillsLoaded` 含 `agents:git-commit` 或 `cursor:git-commit`，且 system 行为体现其内容。
7. **关闭全局**：设置 `skipGlobalSkills: true` 或 `MINI_AGENT_SKIP_GLOBAL_SKILLS=1` 后，不再加载任何全局目录，行为与无全局时一致。

## 异常/失败路径验证（如适用）

- 指定不存在的路径：该路径被跳过，不报错；若所有路径均无效则无 Skill 注入，行为同无 skill。
- Skill 文件内容为空或解析后 content 为空：该条不入结果列表，不注入。
- 非 .md/.json 单文件：按约定忽略（仅目录会扫描约定文件名）。

## Transcript 变更

- `TranscriptPayload` 新增可选字段 `skillsLoaded?: { path: string; charCount: number }[]`。本次 run 若有加载 Skill，则写入 transcript 的 payload 中包含该数组，便于审计本次使用了哪些 Skill 及其内容长度。

## 验收标准（DoD）

- [ ] 指定 `--skill <path>` 或配置 `skillPaths` 后，system prompt 中可见对应 Skill 内容（可通过 transcript 或真实对话效果验证），且 transcript 中能体现本次 run 加载了哪些 Skill（path + charCount）。
- [ ] 无 `--skill` 且配置无 `skillPaths` 且无全局 Skills（或已 `skipGlobalSkills`）时，行为与当前一致（仅使用默认 SYSTEM_PROMPT，无 skillsLoaded）。
- [ ] 全局 Skills：在 `~/.agents/skills/git-commit/` 或 `~/.cursor/skills/` 下放置 `SKILL.md` 时，不传 `--skill`、不配 `skillPaths` 运行，transcript 中 `skillsLoaded` 含 `agents:*` 或 `cursor:*` 前缀，且 system 行为体现其内容；设置 `skipGlobalSkills: true` 或 `MINI_AGENT_SKIP_GLOBAL_SKILLS=1` 后不再加载全局。
- [ ] `pnpm -r build`、`pnpm -r typecheck` 通过。
- [ ] 已有 Phase 的典型命令（如 `mini-agent --provider mock --prompt "hi"`）无回归。
- [ ] Runbook 中列出的成功路径与 verbose/dry-run 示例可跑通。
