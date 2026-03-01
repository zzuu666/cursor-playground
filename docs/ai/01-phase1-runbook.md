# Phase 1 运行与验证说明

## 环境准备

1. **API Key（使用 MiniMax 时）**
   - 复制 `packages/cli/.env.example` 为 `packages/cli/.env`
   - 在 `.env` 中填入 `MINIMAX_API_KEY`（不要提交 `.env`）
   - 可选：`MINIMAX_BASE_URL`、`MINIMAX_MODEL` 有默认值

2. **安装与构建**
   ```bash
   pnpm install
   pnpm -r build
   ```

## 运行方式

在仓库根目录或 `packages/cli` 下执行（以下以 `packages/cli` 为例）：

| 场景 | 命令 |
|------|------|
| 单轮（Mock，无需 key） | `pnpm exec tsx src/index.ts --provider mock --prompt "hello"` |
| 单轮（MiniMax） | `pnpm exec tsx src/index.ts --prompt "你好"` |
| 流式输出 | `pnpm exec tsx src/index.ts --stream --prompt "简述 TypeScript 优点"` |
| 多轮 REPL | `pnpm exec tsx src/index.ts`（进入后输入多行，空行退出） |
| 指定 transcript 目录 | `pnpm exec tsx src/index.ts -t ./logs --prompt "hi"` |

## 成功路径验证

- **单轮 Mock**：`--provider mock --prompt "hi"` 应输出 mock 回复与 `turns=1`，并在默认目录生成 transcript。
- **单轮 MiniMax**：配置好 key 后 `--prompt "1+1"` 应得到模型回复与 transcript。
- **流式**：`--stream --prompt "写一句诗"` 应逐字输出，最后一行仍为 `turns=...`、`transcript=...`。
- **多轮**：REPL 下连续输入 2～3 轮，每轮应有回复且上下文连贯（可问“上一句我说了什么？”）。
- **Transcript**：生成的 JSON 中 `messages` 含完整对话；内容中的密钥形态字符串会被脱敏为 `***`。

## 失败路径验证

- **缺少 API Key**：未设置 `MINIMAX_API_KEY` 且使用默认 provider 时，应报错并退出（提示设置 key 或使用 `--provider mock`），错误信息中不得出现明文 key。
- **无效 Key**：错误 key 时 API 可能返回 401；应得到可读错误并安全退出，无 key 泄露。

## 安全约束（Phase 1）

- API Key 仅从环境变量或 `packages/cli/.env` 读取，不写进代码或 transcript。
- Transcript 与 stderr 输出经脱敏，不包含 `apiKey`、长 token 等敏感值。
