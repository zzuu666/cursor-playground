# Code Agent

一个面向学习的代码代理框架，基于大语言模型（LLM）实现自动化代码生成和操作。

## 功能特性

- 🤖 **多模型支持**：支持 OpenAI (GPT-4/3.5) 和 Anthropic (Claude) 模型
- 🛠️ **工具系统**：内置多种工具，支持文件操作、代码执行、Git 操作等
- 💰 **成本估算**：内置 Token 计数和 API 调用成本估算
- 🔄 **重试机制**：内置指数退避重试，提高任务成功率
- 📝 **上下文管理**：支持消息队列和 token 计数
- 🔍 **错误处理**：完善的错误分类和处理机制
- ⚙️ **灵活配置**：支持自定义工具和模型提供商

## 项目结构

```
src/
├── agent/          # 代理核心逻辑
│   ├── agent.ts    # 主代理类
│   └── runner.ts   # 运行器
├── tools/          # 内置工具集
│   ├── types.ts    # 工具类型定义
│   ├── registry.ts # 工具注册表
│   ├── file.ts     # 文件操作工具
│   └── execute-command.ts # 命令执行工具
├── prompts/        # 提示模板
│   ├── system.ts   # 系统提示词
│   └── task.ts     # 任务提示词
├── infra/          # 基础设施
│   ├── error.ts    # 错误处理
│   ├── logger.ts   # 日志系统
│   └── retry.ts    # 重试机制
├── config/         # 配置管理
│   └── types.ts    # 配置类型
├── types.ts        # 全局类型定义
└── index.ts        # 入口文件
```

## 工具列表

| 工具 | 描述 | 所需参数 |
|------|------|----------|
| `read_file` | 读取文件内容 | `path`: 文件路径 |
| `write_file` | 写入/创建文件 | `path`: 文件路径, `content`: 文件内容, `backup`: 是否备份 |
| `glob_search` | 文件搜索 | `pattern`: glob 模式 |
| `execute_command` | 执行命令行命令 | `command`: 命令字符串 |
| `Task` | 任务管理 | - |

### execute_command 安全特性

- 默认允许的命令：`npm`, `pnpm`, `node`, `npx`, `yarn`, `git`, `tsx`, `tsc`
- 支持自定义白名单
- 输出截断至 32KB
- 支持超时设置

## 错误代码

| 代码 | 描述 |
|------|------|
| 0 | 成功 |
| 1 | 常规错误 |
| 2 | 配置/环境错误（如缺少 API Key、Provider 无效）|
| 3 | 工具错误 |

## 配置说明

CLI 支持多种 LLM 后端（Provider），通过**环境变量**和**配置文件**指定 API Key 与运行参数，**命令行参数**优先级最高。

### 环境变量（按 Provider）

| Provider | 必选环境变量 | 可选环境变量 | 默认 baseURL / model |
|----------|--------------|--------------|------------------------|
| minimax | `MINIMAX_API_KEY` | `MINIMAX_BASE_URL`, `MINIMAX_MODEL` | 见 config 默认值 |
| openai | `OPENAI_API_KEY` | `OPENAI_BASE_URL`, `OPENAI_MODEL` | `https://api.openai.com` / `gpt-4o-mini` |
| deepseek | `DEEPSEEK_API_KEY` | `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL` | `https://api.deepseek.com` / `deepseek-chat` |
| mock | 无 | — | 仅用于测试，无需 Key |

配置 DeepSeek 时，在环境或 `packages/cli/.env` 中设置：

```bash
export DEEPSEEK_API_KEY="你的_DeepSeek_API_Key"
```

然后指定使用 deepseek：

```bash
pnpm exec tsx src/index.ts --provider deepseek --prompt "你好"
# 或指定模型
pnpm exec tsx src/index.ts --provider deepseek --model deepseek-reasoner --prompt "你好"
```

### 配置文件

在工作目录或通过 `--config <path>` 指定路径，支持 `mini-agent.config.json` 或 `.mini-agent.json`。合并顺序：**默认值 → 配置文件 → 环境变量 → 命令行**。

示例：

```json
{
  "provider": "deepseek",
  "model": "deepseek-chat",
  "transcriptDir": "./transcripts",
  "approval": "auto",
  "policy": {
    "maxTurns": 20,
    "maxToolCalls": 10
  }
}
```

API Key 仍通过环境变量提供，配置文件中只写 `provider`、`model` 等运行参数。

### 常用 CLI 参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `--provider <name>` | 使用的 LLM：`minimax` \| `openai` \| `deepseek` \| `mock` | `--provider deepseek` |
| `--model <name>` | 模型名（覆盖配置/环境） | `--model deepseek-reasoner` |
| `--prompt <text>` | 单次用户输入（省略则进入 REPL） | `--prompt "写一个 hello world"` |
| `--config <path>` | 配置文件路径 | `--config ./my.config.json` |
| `--approval <mode>` | 工具批准：`never` \| `auto` \| `prompt` | `--approval prompt` |
| `--verbose` | 打印每轮请求/响应摘要 | `--verbose` |

### 运行示例

```bash
# 使用 mock（无需 API Key）
pnpm exec tsx src/index.ts --provider mock --prompt "hello"

# 使用 DeepSeek（需设置 DEEPSEEK_API_KEY）
pnpm exec tsx src/index.ts --provider deepseek --prompt "写一段 TypeScript 示例"

# 使用 OpenAI（需设置 OPENAI_API_KEY）
pnpm exec tsx src/index.ts --provider openai --model gpt-4o-mini --prompt "hello"
```

## 使用方法

### 基本用法

```typescript
import { CodeAgent } from './src/index';

const agent = new CodeAgent({
  model: 'gpt-4',
  apiKey: process.env.OPENAI_API_KEY,
});

await agent.run('创建一个简单的 HTTP 服务器');
```

### 使用 Anthropic 模型

```typescript
import { CodeAgent, AnthropicProvider } from './src/index';

const agent = new CodeAgent({
  model: 'claude-3-opus-20240229',
  provider: new AnthropicProvider({
    apiKey: process.env.ANTHROPIC_API_KEY,
  }),
});

await agent.run('创建一个简单的 HTTP 服务器');
```

### 自定义工具

```typescript
import { CodeAgent, ToolRegistry } from './src/index';

const customTool = {
  name: 'my_tool',
  description: '自定义工具描述',
  inputSchema: {
    type: 'object',
    properties: {
      param: { type: 'string' }
    },
    required: ['param']
  },
  async execute(args) {
    return `执行结果: ${args.param}`;
  }
};

const registry = new ToolRegistry();
registry.register(customTool);

const agent = new CodeAgent({
  model: 'gpt-4',
  apiKey: process.env.OPENAI_API_KEY,
  toolRegistry: registry,
});
```

### 配置选项

```typescript
interface AgentConfig {
  /** 模型名称 */
  model: string;
  /** API 密钥 */
  apiKey: string;
  /** 模型提供商 (默认 OpenAI) */
  provider?: ModelProvider;
  /** 工具注册表 */
  toolRegistry?: ToolRegistry;
  /** 最大迭代次数 */
  maxIterations?: number;
  /** 系统提示词 */
  systemPrompt?: string;
  /** 温度参数 */
  temperature?: number;
  /** 是否显示调试信息 */
  verbose?: boolean;
}
```

## 开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 开发模式（监听文件变化）
npm run dev

# 类型检查
npm run check
```

## 设计原则

1. **面向学习**：清晰易读的代码结构，每个决策都有注释说明权衡
2. **明确权衡**：在代码中注释决策和权衡，便于理解设计选择
3. **渐进增强**：从基础功能逐步扩展
4. **类型安全**：使用 TypeScript 提供完整的类型支持

## 许可证

MIT
