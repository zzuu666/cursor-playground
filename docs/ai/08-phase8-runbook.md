# Phase 8 运行与验证说明（CLI 体验与分发）

## 核心原理回顾

| 能力 | 核心原理 |
|------|----------|
| 版本与帮助 | CLI 从本包 `package.json` 读取 version，通过 Commander 的 `.version()` 提供 `-V/--version`；description 与 addHelpText 提供商用化说明与示例。 |
| 打包 | `pnpm build` 产出 `dist/index.js`，bin 指向该文件；安装后可通过 `mini-agent` 命令或 `node dist/index.js` 运行。 |
| 发布准备 | `package.json` 中 `files` 限定发布内容（dist、README.md），`engines` 限定 Node >= 18；README 含安装、配置、安全与批准流、退出码与 transcript 说明。 |

## 运行方式

从仓库根或 `packages/cli` 执行。

| 场景 | 命令（示例） |
|------|----------------|
| 查看版本 | `node packages/cli/dist/index.js --version` 或安装后 `mini-agent -V` |
| 查看帮助 | `mini-agent --help` 或 `node packages/cli/dist/index.js --help` |
| 本地安装验证 | 在 monorepo 根：`pnpm build` 后 `pnpm add -g ./packages/cli`，再执行 `mini-agent --version` |
| 单次运行（mock） | `pnpm exec tsx packages/cli/src/index.ts --provider mock --prompt "hello"` 或构建后 `mini-agent --provider mock --prompt "hello"` |

## 成功路径验证

- **版本**：执行 `mini-agent --version` 或 `node dist/index.js --version` 输出与 `packages/cli/package.json` 的 `version` 一致。
- **帮助**：`mini-agent --help` 展示 description、选项列表及末尾 Example。
- **构建与运行**：`pnpm build` 无报错；`node packages/cli/dist/index.js --provider mock --prompt "hi"` 能完成一轮并输出。
- **本地安装**：`pnpm add -g ./packages/cli`（在仓库根或 packages/cli 下）后，`mini-agent --version` 可执行。

## 异常/失败路径验证（如适用）

- 未构建即运行 `node dist/index.js`：若 dist 不存在则报错；需先执行 `pnpm build`。
- 未配置 API Key 使用非 mock provider：与 Phase 7 一致，退出码 2 并提示检查 env。

## 安全/约束（如适用）

- 本 Phase 不新增安全策略；批准流、路径与命令白名单等见 Phase 5/6 及 README「安全与批准流」。
- 发布时仅包含 `files` 所列内容（dist、README.md），避免泄露源码或多余文件。

## 验收标准（DoD）

- 通过 `pnpm add -g ./packages/cli`（或 npx 指向本地构建）可安装并运行 `mini-agent --version` 及 `mini-agent --help`；若包已发布，则 `pnpm add -g @mini-agent/cli` 或 `npx @mini-agent/cli` 可安装并运行。
- `pnpm build` 后 `node packages/cli/dist/index.js --version` 输出版本号；`mini-agent` bin 指向 `dist/index.js` 且可执行。
- README 包含：安装（全局/源码）、最小配置、安全与批准流说明、退出码与 transcript 说明。
- `pnpm -r build`、`pnpm -r typecheck` 通过；Phase 7 典型命令（如 `--provider mock --prompt "hi"`）无回归。
