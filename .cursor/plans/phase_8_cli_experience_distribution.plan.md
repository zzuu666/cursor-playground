---
name: Phase 8 CLI 体验与分发
overview: 实现 Phase 8：改进 CLI 帮助与版本、确保打包可执行、完成 npm 发布准备并补全 README；同时引入 Monorepo 版本管理方案，统一版本来源与发布前同步流程。
todos:
  - id: cli-version-help
    content: 在 index.ts 中增加 --version/-V 与可选 help 示例
  - id: package-files-engines
    content: 在 packages/cli/package.json 增加 files、engines
  - id: readme-sections
    content: README 补全安装、安全与批准流、Transcript、退出码统一
  - id: runbook-and-index
    content: 新增 08-phase8-runbook.md 并更新 SOP 索引
  - id: version-management
    content: 落实 Monorepo 版本管理（版本来源、同步脚本或约定、文档）
isProject: false
---

# Phase 8：CLI 体验与分发（可交付）+ Monorepo 版本管理

## 目标

1. **CLI 可交付**：让 CLI 易于安装、配置和日常使用；改进帮助与版本、打包可执行、npm 发布准备、README 完整。
2. **Monorepo 版本管理**：约定版本唯一来源、发布前同步方式与 bump 流程，避免 root 与 packages/cli 版本不一致。

---

## 一、CLI 体验与分发（原 Phase 8）

### 现状与变更范围

| 项目 | 当前状态 | Phase 8 变更 |
|------|----------|--------------|
| 版本与帮助 | 无 `--version`；Commander 默认 help | 增加 `.version()`，可选优化 description/示例 |
| 打包 | 已有 `bin: {"mini-agent": "dist/index.js"}`，`pnpm build` 产出 dist | 确认 `node dist/index.js` 与 bin 安装后可用 |
| 发布准备 | `private: true`，无 `files`/`engines` | 增加 `files`、`engines` |
| README | 已有配置、退出码、工具表 | 补「安装」「安全与批准流」「Transcript」；退出码与代码一致 |

### 实现要点（摘要）

- **体验**：[packages/cli/src/index.ts](packages/cli/src/index.ts) 从 package.json 读取 version，调用 `program.version(version, '-V, --version', 'show version')`；可微调 description 或 help 后追加示例。
- **打包**：确认 tsconfig `outDir: dist` 与 bin 一致；Runbook 说明本地安装（`pnpm add -g ./packages/cli`）与发布后 `npx @mini-agent/cli`。
- **发布准备**：[packages/cli/package.json](packages/cli/package.json) 增加 `"files": ["dist", "README.md"]`、`"engines": { "node": ">=18" }`。
- **README**：[packages/cli/README.md](packages/cli/README.md) 新增/调整：安装（全局/源码）、安全与批准流、Transcript 说明、退出码与 [exit-codes.ts](packages/cli/src/infra/exit-codes.ts) 一致（0/1/2）。
- **文档**：新增 [docs/ai/08-phase8-runbook.md](docs/ai/08-phase8-runbook.md)，更新 [docs/ai/phase-implementation-sop.md](docs/ai/phase-implementation-sop.md) 索引。

### 验收标准（DoD）

- 通过 `pnpm add -g ./packages/cli` 可安装并运行 `mini-agent --version`、`mini-agent --help`。
- `pnpm build` 后 `node packages/cli/dist/index.js --version` 输出版本号。
- README 包含：安装、最小配置、安全与批准流、退出码与 transcript 说明。
- `pnpm -r build`、`pnpm -r typecheck` 通过；既有 Phase 无回归。

---

## 二、Monorepo 版本管理方案

### 目标

- **单一事实来源**：明确版本号写在哪里，避免 root 与 `packages/cli` 不一致。
- **发布一致**：npm 发布的是 `packages/cli`，其 `version` 必须为发布版本；与 monorepo 版本策略衔接。
- **可复现**：bump 流程文档化，便于 release 与 CHANGELOG（可选）后续扩展。

### 方案选项

| 方案 | 版本来源 | 同步方式 | 适用场景 |
|------|----------|----------|----------|
| **A. 以发布包为准** | `packages/cli/package.json` 的 `version` | 发布前或发布后，用脚本把该 version 写回 root `package.json` | 仅一个包发布、简单 |
| **B. 以 root 为准** | root `package.json` 的 `version` | 发布前用脚本把 root version 同步到 `packages/cli/package.json` | 希望「一个数字管整个仓库」 |
| **C. 工具驱动** | changesets / lerna 等 | 由工具在 release 时统一改版本 | 多包、需要 changelog 与自动化 |

**推荐**：当前仅 `@mini-agent/cli` 一个可发布包，采用 **方案 A**（以 `packages/cli` 为准），并约定「改版本只改 `packages/cli/package.json`，再视需要同步到 root」；若希望 root 与 cli 始终一致，则增加一条同步脚本。

### 实现要点

1. **约定版本来源**
   - **主来源**：`packages/cli/package.json` 的 `version`（npm 发布、CLI `--version` 均读此处）。
   - **Root**：root `package.json` 的 `version` 视为「monorepo 展示用」，与 cli 保持一致；通过脚本或手动在 release 时同步。

2. **同步脚本（可选但建议）**
   - 在 **root** 的 `package.json` 增加脚本，例如：
     - `"version:sync": "node -e \"const p=require('./packages/cli/package.json');const r=require('./package.json');require('fs').writeFileSync('package.json', JSON.stringify({...r,version:p.version}, null, 2));\"`  
       或使用更可读的脚本文件 `scripts/sync-version.js`：读取 `packages/cli/package.json` 的 version，写回 root `package.json`。
   - 约定：**发布或打 tag 前** 先改 `packages/cli` 的 version，再执行 `pnpm version:sync`（或 `node scripts/sync-version.js`）使 root 一致。

3. **CLI 读取版本**
   - Phase 8 的 `--version` 实现：在 `packages/cli/src/index.ts` 中读取 **本包** 的 `package.json`（即 `packages/cli/package.json`），不要读 root，这样与 npm 安装后行为一致。

4. **Bump 流程文档化**
   - 在 README 或 `docs/ai/08-phase8-runbook.md` 中增加「版本与发布」小节：
     - 修改版本：编辑 `packages/cli/package.json` 的 `version`。
     - 同步到 root（若已加脚本）：执行 `pnpm version:sync`（或从仓库根执行 `node scripts/sync-version.js`）。
     - 发布：在 `packages/cli` 目录执行 `npm publish`（或通过 CI）；若使用 `private: true` 则仅用于本地/内部安装，不发布到 npm。

5. **可选扩展**
   - 若后续引入 **changesets**：可将「版本来源」改为 changesets 管理的 version，release 时自动改 `packages/cli` 与 root；Phase 8 仅需约定当前简单流程即可。

### 文件变更清单（版本管理部分）

| 文件 | 变更说明 |
|------|----------|
| [package.json](package.json)（root） | 可选：增加 `"scripts": { "version:sync": "..." }` |
| **新增** `scripts/sync-version.js`（或内联在 root scripts） | 从 `packages/cli/package.json` 读 version，写回 root `package.json` |
| [docs/ai/08-phase8-runbook.md](docs/ai/08-phase8-runbook.md) | 增加「版本与发布」小节：版本来源、bump 步骤、同步命令 |

### 验收（版本管理）

- 修改 `packages/cli/package.json` 的 `version` 后，执行同步脚本（若已实现）可使 root `package.json` 的 version 与之相同。
- CLI `mini-agent --version` 输出与 `packages/cli/package.json` 的 version 一致。
- Runbook 或 README 中能按文档完成一次「改版 + 可选同步」的流程。

---

## 三、合并后的文件变更清单

| 文件 | 变更说明 |
|------|----------|
| [packages/cli/src/index.ts](packages/cli/src/index.ts) | 读取本包 version，`program.version()`；可选 description/helpText |
| [packages/cli/package.json](packages/cli/package.json) | 增加 `files`、`engines` |
| [packages/cli/README.md](packages/cli/README.md) | 安装、安全与批准流、Transcript、退出码统一 |
| [package.json](package.json)（root） | 可选：`version:sync` 脚本 |
| **新增** `scripts/sync-version.js` | 可选：cli version 同步到 root |
| **新增** [docs/ai/08-phase8-runbook.md](docs/ai/08-phase8-runbook.md) | 运行方式、DoD、版本与发布流程 |
| [docs/ai/phase-implementation-sop.md](docs/ai/phase-implementation-sop.md) | 索引增加 Phase 8 |

---

## 四、实现顺序建议

1. **Monorepo 版本约定与脚本**：确定方案 A，实现 `scripts/sync-version.js` 与 root 的 `version:sync`（可选），文档化 bump 流程。
2. **CLI 体验**：index.ts 中读取 `packages/cli/package.json` 的 version，添加 `--version`/`-V`。
3. **打包与发布准备**：package.json 的 `files`、`engines`。
4. **README**：安装、安全与批准流、Transcript、退出码。
5. **Runbook 与索引**：08-phase8-runbook.md（含版本与发布小节）、SOP 索引更新。
6. **验收**：DoD 与版本管理验收逐条执行。
