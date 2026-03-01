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
| 2 | 代理错误（配置无效等）|
| 3 | 工具错误 |

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
