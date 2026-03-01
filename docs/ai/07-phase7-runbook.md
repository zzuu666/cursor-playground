# Phase 7 运行与验证说明（多 Provider 与韧性）

## 核心原理回顾

| 能力 | 核心原理 |
|------|----------|
| Provider 工厂 | 通过 `createProvider(providerId, resolved, tools)` 按配置的 provider 名称创建实例；新增后端只需在工厂中注册，入口不改。 |
| Provider 标识 | 支持 `minimax`（Anthropic 兼容）、`openai`、`deepseek`、`mock`。`openai` 与 `deepseek` 共用 OpenAI 兼容 API 实现，仅默认 baseURL 与 env 不同。 |
| OpenAI 兼容 API | 使用 `POST {baseURL}/v1/chat/completions`，请求/响应格式与 OpenAI 一致；支持 tools、tool_calls、role tool。 |
| 配置与 env | 各 provider 的 apiKey/baseURL/model 由 config 层按 provider 从对应环境变量与默认值解析；创建失败时统一报错并提示检查 env。 |
| 重试 | 与既有逻辑一致：429/5xx 及网络错误由 `retryWithBackoff` 重试，耗尽后抛出，由上层提示检查配置/网络。 |

## 环境变量与配置项

| Provider | 必选环境变量 | 可选环境变量 | 默认 baseURL / model |
|----------|--------------|--------------|----------------------|
| minimax | `MINIMAX_API_KEY` | `MINIMAX_BASE_URL`, `MINIMAX_MODEL` | 见 config 默认值 |
| openai | `OPENAI_API_KEY` | `OPENAI_BASE_URL`, `OPENAI_MODEL` | `https://api.openai.com` / `gpt-4o-mini` |
| deepseek | `DEEPSEEK_API_KEY` | `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL` | `https://api.deepseek.com` / `deepseek-chat` |
| mock | 无 | — | — |

- 配置文件与 CLI 中的 `provider`、`model` 仍按既有合并顺序生效；openai/deepseek 的 model 可由 `--model` 或配置的 `model` 覆盖，未设置时使用上表默认 model。

## 运行方式

从 `packages/cli` 或仓库根执行。

| 场景 | 命令（示例） |
|------|----------------|
| 使用 mock（无需 API key） | `pnpm exec tsx src/index.ts --provider mock --prompt "hello"` |
| 使用 DeepSeek | 设置 `DEEPSEEK_API_KEY` 后：`pnpm exec tsx src/index.ts --provider deepseek --prompt "hello"` |
| 使用 OpenAI | 设置 `OPENAI_API_KEY` 后：`pnpm exec tsx src/index.ts --provider openai --prompt "hello"` |
| 使用 minimax（既有） | 设置 `MINIMAX_API_KEY` 后：`pnpm exec tsx src/index.ts --provider minimax --prompt "hello"` |
| 指定 model | `--provider deepseek --model deepseek-reasoner --prompt "..."` 或通过配置文件 `model` |

## 成功路径验证

- **mock**：`--provider mock --prompt "hi"` 输出固定文案，无网络请求。
- **openai**：配置 `OPENAI_API_KEY` 后 `--provider openai --prompt "hi"` 能完成一轮对话；带工具时能收到 tool_calls 并继续。
- **deepseek**：配置 `DEEPSEEK_API_KEY` 后 `--provider deepseek --prompt "hi"` 能完成一轮对话；行为与 openai 一致（同一实现、不同默认 baseURL/model）。
- **minimax**：与 Phase 6 一致，`--provider minimax` 使用 Anthropic 兼容 API，行为无回归。

## 异常/失败路径验证

- **未知 provider**：`--provider invalid` 应报错并退出码 2，提示 "Unknown provider ... Supported: minimax, openai, deepseek, mock" 及检查 env 的提示。
- **缺少 API key**：如未设置 `DEEPSEEK_API_KEY` 却使用 `--provider deepseek`，应报错并提示 "DEEPSEEK_API_KEY is required for provider 'deepseek'"（或对应 key 名称），退出码 2。
- **API 错误**：当 API 返回 429/5xx 时，会先按 policy 重试；重试耗尽后抛出，用户可见错误信息并可根据提示检查配置/网络。

## 验收标准（DoD）

- 通过配置或 CLI 切换 `--provider minimax | openai | deepseek | mock` 可完成对话与工具调用。
- `--provider deepseek` 且设置 `DEEPSEEK_API_KEY`（及可选 `DEEPSEEK_MODEL`/baseURL）时，能正常调用 DeepSeek API（OpenAI 格式）。
- `--provider openai` 且设置 `OPENAI_API_KEY` 时，能正常调用 OpenAI 或任意 baseURL 的 OpenAI 兼容 API。
- 文档（本 Runbook）中说明各 Provider 所需环境变量与配置项（含 DeepSeek）。
- `pnpm -r build`、`pnpm -r typecheck` 通过；既有 Phase 的典型命令（如 `--provider mock --prompt "hi"`）无回归。
