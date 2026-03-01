# Issue 006：Transcript 默认目录应落在 CLI 包下

## 背景

原逻辑中，默认 `transcriptDir` 为 `join(cwd, "transcripts")`，即**当前工作目录**下的 `transcripts/`。当从仓库根执行（例如 `node packages/cli/dist/index.js --prompt "hello"`）时，transcript 会写到 **root/transcripts/**，与预期「输出集中在 packages/cli 下」不符，且易污染仓库根目录。

期望：未通过配置文件、环境变量或 `--transcript-dir` 指定时，默认将 transcript 写到 **packages/cli/transcripts/**，与运行时的 cwd 无关。

## 实现（已修复）

1. **LoadConfigOptions** 增加可选参数 `defaultTranscriptDir?: string`。若调用方传入，则默认 `transcriptDir` 使用该值；否则仍为 `join(cwd, "transcripts")`。
2. **index.ts** 在调用 `loadConfig` 前，根据当前执行文件路径计算 CLI 包根目录（`dist/index.js` 的上一级即 `packages/cli`），并传入 `defaultTranscriptDir: join(cliPackageRoot, "transcripts")`。
3. 配置文件、`TRANSCRIPT_DIR`、`-t/--transcript-dir` 的覆盖逻辑不变，仍可覆盖该默认值。

## 涉及文件

- `packages/cli/src/config.ts`：`LoadConfigOptions.defaultTranscriptDir`，defaults 中 `transcriptDir` 使用 `defaultTranscriptDir ?? join(cwd, "transcripts")`。
- `packages/cli/src/index.ts`：`dirname` + `fileURLToPath(import.meta.url)` 得到 CLI 包根，传入 `loadConfig({ defaultTranscriptDir: join(cliPackageRoot, "transcripts"), ... })`。

## 验收

- 从仓库根执行 `node packages/cli/dist/index.js --provider mock --prompt "hi"`，生成的 transcript 位于 `packages/cli/transcripts/` 下，而非 `transcripts/`（根目录）。
- 从 `packages/cli` 下执行或通过配置/CLI 指定 `--transcript-dir` 时，行为符合既有逻辑。
