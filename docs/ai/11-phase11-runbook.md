# Phase 11 运行与验证说明（MCP 客户端）

## 核心原理回顾

| 能力 | 核心原理 |
|------|----------|
| MCP 配置 | 与 [Claude Code MCP](https://code.claude.com/docs/en/mcp) 一致：`mcpServers` 支持 **stdio**（command/args/env）与 **HTTP**（type: "http", url, headers）。配置来源：mini-agent.config.json、项目根 `.mcp.json`、已加载插件的 `.mcp.json` 或 plugin.json 的 `mcpServers`。 |
| 环境变量展开 | 配置值中支持 `${VAR}` 与 `${VAR:-default}`（command、args、env、url、headers）；插件内支持 `${PLUGIN_ROOT}`。 |
| 连接与工具 | 启动时对 `enabledMcpServerNames` 中的每个 server 建立连接（stdio 子进程或 HTTP），请求 `tools/list`，将每个 MCP tool 转为 CLI Tool，注册名为 `mcp_<serverName>_<toolName>`，execute 时转发到 MCP `tools/call`。 |
| 可观测性 | transcript 增加 `mcpServersLoaded: { name, tools[] }[]`；`--verbose` 打印已连接 MCP 及工具列表；工具名前缀 `mcp_` 可区分来源。 |

## 配置示例

项目根 `.mcp.json`（与 Claude Code 可复用）：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"],
      "env": {}
    },
    "sentry": {
      "type": "http",
      "url": "https://mcp.sentry.dev/mcp",
      "headers": {}
    }
  }
}
```

`mini-agent.config.json` 内也可写 `mcpServers`，结构同上。

## 运行方式

| 场景 | 命令（示例） |
|------|----------------|
| 无 MCP（与当前一致） | `mini-agent --provider mock --prompt "hello"` |
| 项目 .mcp.json 自动加载 | 在 cwd 放置 `.mcp.json`，运行 `mini-agent --provider mock --prompt "list files"`，若配置了 stdio server 则自动连接并注入工具。 |
| 仅启用部分 server | `mini-agent --mcp filesystem --prompt "read file x"`（仅连接名为 filesystem 的 server）。 |
| verbose 看 MCP | `mini-agent --verbose --prompt "hi"`，若有 MCP 则 stderr 出现 `[verbose] mcp servers: name (tool1, tool2)`。 |
| dry-run | `mini-agent --dry-run --prompt "x"`，若有 MCP 配置则 stderr 出现 `[dry-run] mcp servers (configured): ...`。 |

## 成功路径验证

1. **无 MCP**：不配置 `mcpServers`、无 `.mcp.json`、不传 `--mcp` 时，行为与 Phase 10 一致。
2. **Stdio**：在配置或 `.mcp.json` 中配置一个 stdio MCP server（如 npx 启动的 server），运行后 dry-run 或 verbose 能列出其 tools；一次对话中能成功调用至少一个 MCP tool，结果回填到 session。
3. **HTTP**：配置 type: "http" 的 server（如社区示例 url），能连接并列出 tools、成功调用。
4. **配置兼容**：项目根放置与 Claude Code 同格式的 `.mcp.json`，CLI 能读取并连接，无需在 mini-agent.config.json 重复书写。
5. **插件 MCP**：启用含 `mcpServers` 的插件时，其 MCP 参与合并；能连接并调用插件提供的 MCP tool（键为 `pluginName__serverName`）。

## 异常/失败路径验证

- MCP server 连接失败（命令不存在、HTTP 超时等）：该 server 被跳过，stderr 输出 `[mcp] failed to connect "name": ...`，不拖垮主流程。
- `--mcp name` 指定的 name 在配置中不存在：该 name 被跳过，无对应连接。
- 未设置且无默认的环境变量（如 `${API_KEY}`）：展开后可能为空，连接或调用可能失败，按上一条记录错误。

## 安全/约束

- MCP 以与 CLI 相同权限运行；stdio 会启动子进程，用户应只配置可信 server。HTTP 请求使用配置的 url 与 headers，不自动做 OAuth 交互。
- 工具执行超时由 `policy.toolTimeoutMs` 控制，默认 15_000 ms，可在 config 的 policy 中覆盖。

## 验收标准（DoD）

- [ ] 在配置或项目 `.mcp.json` 中配置 stdio MCP server，CLI 能列出其 tools 并在一次对话中成功调用至少一个 MCP tool，结果正确回填。
- [ ] 配置 HTTP 类型 MCP server 能连接并列出 tools、成功调用至少一个 tool。
- [ ] 项目根放置与 Claude Code 格式一致的 `.mcp.json`，CLI 能读取并连接其中配置的 server。
- [ ] 启用含 `mcpServers` 的插件时，其 MCP server 参与合并；能连接并调用插件提供的 MCP tool。
- [ ] 未配置 MCP 时行为与当前一致。
- [ ] `pnpm -r build`、`pnpm -r typecheck` 通过；已有 Phase 典型命令无回归。
- [ ] transcript 含 `mcpServersLoaded`；verbose 能区分 MCP 工具调用（工具名前缀 `mcp_`）。

详细方案见 [plan-phase-11.md](plan-phase-11.md)；路线见 [09-cli-advanced-roadmap.md](09-cli-advanced-roadmap.md) § Phase 11。
