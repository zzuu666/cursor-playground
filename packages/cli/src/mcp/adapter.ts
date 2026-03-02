/**
 * 将 MCP 拉取的 tool 定义转为 CLI 的 Tool 形态，execute 时转发到 MCP tools/call。
 */

import type { McpConnection, McpToolDef } from "./client.js";
import type { Tool } from "../tools/types.js";
import type { ToolInputSchema } from "../tools/types.js";

/** 将 MCP tool name 转为注册名：mcp_<serverName>_<toolName>，非字母数字替换为 _ */
export function mcpToolRegisteredName(serverName: string, toolName: string): string {
  const safeServer = serverName.replace(/[^a-zA-Z0-9]/g, "_");
  const safeTool = toolName.replace(/[^a-zA-Z0-9]/g, "_");
  return `mcp_${safeServer}_${safeTool}`;
}

function mapInputSchema(schema: McpToolDef["inputSchema"]): ToolInputSchema {
  return {
    type: "object",
    properties: schema.properties,
    required: schema.required,
  } as ToolInputSchema;
}

/**
 * 为已连接的 MCP server 创建 Tool 适配器列表，注册名带 mcp_<server>_ 前缀；
 * execute 时调用 client.callTool，超时由 toolTimeoutMs 控制。
 */
export function createToolAdapters(
  serverName: string,
  connection: McpConnection,
  toolTimeoutMs?: number
): Tool[] {
  const { client, tools } = connection;
  const timeoutMs = toolTimeoutMs ?? 60_000;

  return tools.map((t) => {
    const registeredName = mcpToolRegisteredName(serverName, t.name);
    const originalName = t.name;
    const inputSchema = mapInputSchema(t.inputSchema);

    const tool: Tool = {
      name: registeredName,
      description: t.description ?? `MCP tool: ${originalName}`,
      inputSchema,
      requiresApproval: false,
      async execute(args: Record<string, unknown>): Promise<string> {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("Tool timeout")), timeoutMs);
        });
        const callPromise = client.callTool(
          { name: originalName, arguments: args },
          undefined,
          { timeout: timeoutMs }
        );
        try {
          const result = await Promise.race([callPromise, timeoutPromise]);
          const content = result?.content;
          if (!Array.isArray(content)) {
            return typeof result === "string" ? result : JSON.stringify(result ?? "");
          }
          const parts: string[] = [];
          for (const item of content) {
            if (item && typeof item === "object" && "type" in item) {
              if (item.type === "text" && "text" in item && typeof item.text === "string") {
                parts.push(item.text);
              } else {
                parts.push(`[${item.type}]`);
              }
            }
          }
          return parts.join("\n");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return `Tool error: ${message}`;
        }
      },
    };
    return tool;
  });
}
