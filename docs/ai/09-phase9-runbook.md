# Phase 9 运行与验证说明（Skill 加载机制）

## 核心原理回顾

| 能力 | 核心原理 |
|------|----------|
| Skill 来源 | 配置项 `skillPaths`（JSON 数组）与 CLI `--skill <paths...>`；合并顺序为「先配置后 CLI 追加」。 |
| 格式 | 单文件：`.md` 按 SKILL.md 解析（可选 YAML frontmatter + body）；`.json` 按 skill.json 解析（`systemPromptAddition` / `description`）。目录：扫描其下 `SKILL.md`、`skill.json` 逐个加载。 |
| System 注入 | 入口在 loadConfig 后调用 `loadSkills` → `buildSystemPrompt`，得到「默认 SYSTEM_PROMPT + [Skill: path] + content」拼接串，写入 `resolved.systemPrompt`；各 provider 使用该字段（有则用，无则用默认）。 |
| 可观测性 | transcript 增加可选 `skillsLoaded: { path, charCount }[]`；`--verbose` 时 stderr 打印 `[verbose] skills loaded: path1 (N chars), ...`。 |

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

## 成功路径验证

1. **无 Skill**：`mini-agent --provider mock --prompt "hello"` 行为与 Phase 8 一致，无 skill 相关日志，transcript 无 `skillsLoaded`。
2. **单文件**：准备一个 `SKILL.md`（如仅含 `You prefer concise answers.`），执行 `mini-agent --provider mock --skill ./SKILL.md --prompt "say hi"`，transcript 中 `skillsLoaded` 含该路径与 charCount；若用真实 provider，模型回复应体现 Skill 内容。
3. **目录**：在目录内放置 `SKILL.md` 或 `skill.json`，`--skill ./that-dir` 后 transcript 中应出现该目录下被扫描到的文件路径。
4. **Verbose**：`--verbose` 且本次加载了 Skill 时，stderr 在首轮前出现一行 `[verbose] skills loaded: path1 (N chars), ...`。
5. **配置 + CLI 合并**：配置中 `skillPaths: ["./a"]`，CLI 再传 `--skill ./b`，最终应加载 a 与 b（先 a 后 b）。

## 异常/失败路径验证（如适用）

- 指定不存在的路径：该路径被跳过，不报错；若所有路径均无效则无 Skill 注入，行为同无 skill。
- Skill 文件内容为空或解析后 content 为空：该条不入结果列表，不注入。
- 非 .md/.json 单文件：按约定忽略（仅目录会扫描约定文件名）。

## Transcript 变更

- `TranscriptPayload` 新增可选字段 `skillsLoaded?: { path: string; charCount: number }[]`。本次 run 若有加载 Skill，则写入 transcript 的 payload 中包含该数组，便于审计本次使用了哪些 Skill 及其内容长度。

## 验收标准（DoD）

- [ ] 指定 `--skill <path>` 或配置 `skillPaths` 后，system prompt 中可见对应 Skill 内容（可通过 transcript 或真实对话效果验证），且 transcript 中能体现本次 run 加载了哪些 Skill（path + charCount）。
- [ ] 无 `--skill` 且配置无 `skillPaths` 时，行为与当前一致（仅使用默认 SYSTEM_PROMPT，无 skillsLoaded）。
- [ ] `pnpm -r build`、`pnpm -r typecheck` 通过。
- [ ] 已有 Phase 的典型命令（如 `mini-agent --provider mock --prompt "hi"`）无回归。
- [ ] Runbook 中列出的成功路径与 verbose/dry-run 示例可跑通。
