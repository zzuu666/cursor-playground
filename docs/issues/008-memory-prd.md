# PRD：Memory 能力产品需求文档

> 基于 [Claude Code Memory 官方文档](https://code.claude.com/docs/en/memory) 的最佳实践整理，用于指导项目中「持久化记忆」相关能力的设计与实现。

## 1. 产品概述

### 1.1 目标

在每次会话以全新上下文启动的前提下，通过**持久化记忆**机制，让 AI 助手能够：

- 跨会话保留对项目、工作流的理解；
- 遵循用户/团队事先写好的规范与偏好；
- 自动积累从纠错与使用中习得的模式（构建命令、调试经验、代码风格等）。

### 1.2 核心原则

- Memory 作为**上下文**注入会话，而非强制配置；表述越具体、越简洁，遵循度越高。
- **谁写、谁用**要区分清楚：用户编写的指令 vs 模型自动记录的学到的内容，对应不同机制与存储位置。

---

## 2. 双机制总览

| 维度       | CLAUDE.md 文件     | Auto Memory（自动记忆）   |
|------------|--------------------|----------------------------|
| **撰写者** | 用户               | 模型自身                   |
| **内容**   | 指令与规则         | 学到的模式与经验           |
| **作用域** | 项目 / 用户 / 组织 | 按工作树（如 git 仓库）    |
| **加载**   | 每会话             | 每会话（仅前 200 行）      |
| **用途**   | 编码规范、流程、架构 | 构建命令、调试洞察、偏好发现 |

- **CLAUDE.md**：用于主动「指导」模型行为。
- **Auto Memory**：用于在用户不做额外操作的前提下，让模型从纠错与使用中积累知识。

---

## 3. CLAUDE.md 规范

### 3.1 放置位置与作用域

按作用域从大到小，支持多级叠加；**更具体的位置优先**。

| 作用域         | 路径（示例） | 用途说明           | 共享范围     |
|----------------|--------------|--------------------|--------------|
| 组织托管策略   | 系统级路径（如 macOS: `/Library/Application Support/ClaudeCode/CLAUDE.md`） | 公司规范、安全与合规 | 全组织       |
| 项目指令       | `./CLAUDE.md` 或 `./.claude/CLAUDE.md` | 架构、规范、通用流程 | 通过版本控制与团队共享 |
| 用户指令       | `~/.claude/CLAUDE.md` | 个人偏好（所有项目） | 仅当前用户   |
| 本地指令       | `./CLAUDE.local.md` | 项目内个人偏好，不入库 | 仅当前用户、当前项目 |

- 当前工作目录**之上**的目录树中的 CLAUDE.md，在启动时**完整加载**。
- **子目录**中的 CLAUDE.md 在模型访问到该目录下的文件时**按需加载**。

### 3.2 加载顺序与排除

- 沿工作目录**自下而上**查找并加载各层 CLAUDE.md、CLAUDE.local.md。
- 大 monorepo 中若会误加载其他团队的 CLAUDE.md，可通过 **claudeMdExcludes**（路径或 glob）排除；组织托管策略的 CLAUDE.md **不可被排除**。
- 通过 **--add-dir** 引入的额外目录，默认不加载其 CLAUDE.md；若需加载，需设置环境变量（如 `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`）。

### 3.3 写作最佳实践

- **体量**：单文件建议 **≤200 行**；过长会占用上下文并降低遵循度；可拆分为多文件并通过 `@path` 引用或 `.claude/rules/` 组织。
- **结构**：用 Markdown 标题与列表分组，便于模型与人类扫读。
- **具体性**：指令需可验证，例如：
  - 「API  handlers 放在 `src/api/handlers/`」优于「保持文件整洁」；
  - 「提交前执行 `npm test`」优于「要测试」；
  - 「使用 2 空格缩进」优于「注意格式」。
- **一致性**：避免多条指令互相矛盾；需定期检查 CLAUDE.md、子目录 CLAUDE.md 与 `.claude/rules/`，删除过时或冲突内容。

### 3.4 引用与模块化

- 使用 **`@path/to/file`** 在 CLAUDE.md 中引用其他文件；支持相对路径（相对当前文件）与绝对路径，递归深度建议限制（如最多 5 层）。
- **CLAUDE.local.md** 仅本地、不入库，适合放个人偏好；多 worktree 若需共享同一套个人说明，可改为引用用户目录下的文件（如 `@~/.claude/my-project-instructions.md`）。

### 3.5 规则目录 `.claude/rules/`

- 将说明按主题拆成多个 `.md` 放在 `.claude/rules/`，便于维护与按路径加载。
- **路径限定规则**：在 frontmatter 中通过 **paths**（glob）限定仅在处理匹配文件时加载，例如：
  - `paths: ["src/api/**/*.ts"]`：仅在与 API 相关文件交互时加载。
- 无 **paths** 的规则在会话启动时与主 CLAUDE.md 一同加载。
- 支持通过**符号链接**在多个项目间共享同一套 rules。
- **用户级规则**：`~/.claude/rules/` 对所有项目生效，加载顺序上通常先于项目规则，因此项目规则可覆盖用户规则。

### 3.6 大团队与组织

- 组织级 CLAUDE.md 通过系统路径部署，由 MDM/组策略/Ansible 等统一下发。
- Monorepo 中通过 **claudeMdExcludes** 排除无关团队或无关子路径的 CLAUDE.md，避免指令冲突与噪音。

---

## 4. Auto Memory 规范

### 4.1 开关与存储

- **默认开启**；可通过会话内 `/memory` 的开关或配置项（如 **autoMemoryEnabled**）关闭；也可通过环境变量（如 `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`）关闭。
- **存储位置**：按项目（如按 git 仓库根派生）在用户目录下建立独立目录，例如 `~/.claude/projects/<project>/memory/`。
- 同一 git 仓库的多个 worktree / 子目录**共享**同一 auto memory 目录；**不跨机器、不跨云环境**同步。

### 4.2 目录结构

```
~/.claude/projects/<project>/memory/
├── MEMORY.md          # 索引与摘要，每会话加载
├── debugging.md       # 调试相关笔记
├── api-conventions.md # API 约定等
└── ...                # 其他主题文件
```

- **MEMORY.md**：作为入口与索引，模型在会话中读写该目录时以此维护「存了什么、存在哪」。
- **主题文件**：详细内容可放在独立文件中，**不在会话启动时加载**，由模型在需要时按需读取。

### 4.3 加载策略

- 仅 **MEMORY.md 的前 200 行**在**每次会话开始时**加载；超过 200 行的部分不会在启动时注入。
- 为控制体量，应保持 MEMORY.md 简洁，将详细内容迁移到主题文件中。
- 主题文件（如 `debugging.md`）**不**在启动时加载，仅在模型通过文件工具访问时加载。

### 4.4 审计与编辑

- 所有 auto memory 文件为**纯 Markdown**，用户可随时查看、编辑或删除。
- 通过 **/memory** 可列出当前会话加载的 CLAUDE.md 与 rules、开关 auto memory、打开 auto memory 目录并选择文件在编辑器中打开。
- 若希望某条内容长期由模型遵循，应写入 CLAUDE.md；若仅希望模型「记住」经验与偏好，可由模型写入 auto memory。

---

## 5. 故障排查（Troubleshooting）

| 问题                     | 建议排查与处理 |
|--------------------------|----------------|
| 模型未按 CLAUDE.md 执行  | 检查多层级 CLAUDE.md / rules 是否冲突；将表述改得更具体；用 `/memory` 确认相关文件是否被加载。 |
| 不知道 auto memory 存了什么 | 使用 `/memory` 打开 auto memory 目录，直接查看与编辑。 |
| CLAUDE.md 过大           | 控制在约 200 行内；用 `@path` 引用或拆到 `.claude/rules/`。 |
| 执行 `/compact` 后指令丢失 | CLAUDE.md 在 compact 后会重新从磁盘加载；若「丢失」的指令只出现在对话中而未写入 CLAUDE.md，则不会持久化，需显式写入 CLAUDE.md。 |

---

## 6. 非功能需求与约束

- **上下文预算**：CLAUDE.md 与 MEMORY.md 前 200 行均占用会话上下文；设计时要考虑总 token 与遵循度的平衡。
- **优先级**：组织托管 &gt; 项目 &gt; 用户 &gt; 本地；同层内更具体路径优先；规则与 CLAUDE.md 的 paths 限定可进一步减少无关上下文。
- **子代理**：若有子代理（subagent），可为其单独配置持久化记忆，与主会话记忆隔离。
- **技能（Skills）**：仅在被调用或判定相关时加载，适合「按需执行」的流程，与「每会话必载」的 CLAUDE.md / auto memory 区分使用。

---

## 7. 相关资源

- [Subagent memory](https://code.claude.com/en/sub-agents#enable-persistent-memory)：子代理独立记忆
- [Sessions](https://code.claude.com/en/sessions)：会话与上下文管理
- [Settings](https://code.claude.com/en/settings)：行为与配置
- [Skills](https://code.claude.com/en/skills)：按需加载的可复用流程

---

## 8. 文档与变更记录

- 来源：Claude Code 官方 Memory 文档（https://code.claude.com/docs/en/memory）
- 用途：作为本项目实现或对接「Memory」类能力时的 PRD 与最佳实践参考
- 更新：可根据实际实现与社区文档变更对本 PRD 做修订
