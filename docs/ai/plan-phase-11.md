# Phase 11 方案：MCP 客户端

## 目标

CLI 作为 MCP **客户端**，能够连接到一个或多个 MCP 服务器（**stdio** 与 **HTTP** 传输），获取其暴露的 tools 并注入当前 Agent Loop。配置格式与 [Claude Code MCP](https://code.claude.com/docs/en/mcp) 及社区常用 `.mcp.json` 兼容。未配置或未指定 MCP 时行为与当前一致。

## 实现要点

1. **类型与配置**：`McpServerConfig` 联合类型（stdio：command/args/env；HTTP：type/url/headers）；`ConfigFile`/`ResolvedConfig` 增加 `mcpServers`、`enabledMcpServerNames`；支持项目级 `.mcp.json`；环境变量展开 `${VAR}`、`${VAR:-default}`。
2. **插件 MCP**：从已加载插件的 `.mcp.json` 或 `plugin.json` 的 `mcpServers` 合并；占位符 `${PLUGIN_ROOT}` 展开。
3. **MCP 客户端与适配器**：`@modelcontextprotocol/sdk`，stdio + HTTP transport；`connectAndListTools` 连接并拉取 tools/list；适配器将 MCP tool 转为 CLI `Tool`，注册名 `mcp_<server>_<tool>`，execute 转发 `tools/call`。
4. **与 Loop 集成**：无改 loop；MCP 以 Tool 身份注册，超时用 `policy.toolTimeoutMs`。
5. **CLI**：`--mcp <name>` 可多次，过滤启用的 server；不传则启用全部已合并 mcpServers。
6. **可观测性**：transcript `mcpServersLoaded`；verbose 打印已连接 MCP 及工具列表。

## 验收标准（DoD）

- 配置或项目 `.mcp.json` 中配置 stdio MCP server，CLI 能列出 tools 并成功调用至少一个 MCP tool。
- 配置 HTTP 类型 MCP server 能连接并调用。
- 项目根 `.mcp.json`（与 Claude Code 同格式）可被读取并连接。
- 插件含 `mcpServers` 时参与合并，能连接并调用插件提供的 MCP tool。
- 未配置 MCP 时行为与当前一致。
- `pnpm -r build`、`pnpm -r typecheck` 通过；无回归。
- transcript 含 `mcpServersLoaded`；verbose 能区分 MCP 工具（前缀 `mcp_`）。

详细路线见 [09-cli-advanced-roadmap.md](09-cli-advanced-roadmap.md) § Phase 11。
