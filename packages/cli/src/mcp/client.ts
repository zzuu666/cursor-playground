/**
 * MCP 客户端封装：按配置创建 stdio 或 HTTP transport，连接后拉取 tools/list。
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerConfig, McpServerConfigHttp } from "../config.js";
import { isMcpServerConfigHttp } from "../config.js";

const CLIENT_NAME = "mini-agent";
const CLIENT_VERSION = "0.1.0";

export interface McpToolDef {
  name: string;
  description?: string | undefined;
  inputSchema: {
    type: "object";
    properties?: Record<string, object>;
    required?: string[];
    [k: string]: unknown;
  };
}

export interface McpConnection {
  client: Client;
  tools: McpToolDef[];
}

/**
 * 根据 config 创建 Transport（stdio 或 HTTP），连接 MCP server 并拉取 tools 列表。
 * 连接失败时抛出，由上层决定是否跳过该 server。
 */
export async function connectAndListTools(
  serverName: string,
  config: McpServerConfig,
  timeoutMs?: number
): Promise<McpConnection> {
  const client = new Client(
    { name: CLIENT_NAME, version: CLIENT_VERSION },
    { capabilities: {} }
  );

  if (isMcpServerConfigHttp(config)) {
    const c = config as McpServerConfigHttp;
    let url: URL;
    try {
      url = new URL(c.url);
    } catch {
      throw new Error(`MCP server "${serverName}": invalid url ${c.url}`);
    }
    const requestInit: RequestInit = {};
    if (c.headers && Object.keys(c.headers).length > 0) {
      requestInit.headers = c.headers;
    }
    const transport = new StreamableHTTPClientTransport(url, { requestInit }) as Transport;
    await client.connect(transport, { ...(timeoutMs != null && { timeout: timeoutMs }) });
  } else {
    const stdioParams: { command: string; args: string[]; env?: Record<string, string> } = {
      command: config.command,
      args: config.args ?? [],
    };
    if (config.env != null && Object.keys(config.env).length > 0) stdioParams.env = config.env;
    const transport = new StdioClientTransport(stdioParams) as Transport;
    await client.connect(transport, { ...(timeoutMs != null && { timeout: timeoutMs }) });
  }

  const result = await client.listTools(undefined, {
    ...(timeoutMs != null && { timeout: timeoutMs }),
  });
  const tools: McpToolDef[] = (result.tools ?? []).map((t) => {
    const ischema = t.inputSchema ?? { type: "object" as const };
    return {
      name: t.name,
      ...(t.description != null && { description: t.description }),
      inputSchema: ischema,
    } as McpToolDef;
  });

  return { client, tools };
}
