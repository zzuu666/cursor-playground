/**
 * 环境变量展开：支持 ${VAR} 与 ${VAR:-default}，与 Claude Code .mcp.json 行为一致。
 * 可选 context 用于覆盖/注入（如 PLUGIN_ROOT）。
 */

import type { McpServerConfig, McpServerConfigHttp, McpServerConfigStdio } from "../config.js";

const VAR_PATTERN = /\$\{([^}:]+)(?::-([^}]*))?\}/g;

/**
 * 对字符串中的 ${VAR} 与 ${VAR:-default} 进行展开；context 优先于 process.env。
 */
export function expandEnvValue(
  value: string,
  context?: Record<string, string>
): string {
  return value.replace(VAR_PATTERN, (_, name: string, defaultVal: string | undefined): string => {
    if (context && name in context) {
      const v = context[name];
      if (v !== undefined) return v;
    }
    const envVal = process.env[name];
    if (envVal !== undefined && envVal !== "") return envVal;
    if (defaultVal !== undefined) return defaultVal;
    return "";
  });
}

/**
 * 对单个 MCP 服务配置做环境变量展开（command、args、env、url、headers）。
 * context 可选，用于插件内 ${PLUGIN_ROOT} 等占位符。
 */
export function expandMcpServerConfig(
  config: McpServerConfig,
  context?: Record<string, string>
): McpServerConfig {
  const expand = (s: string) => expandEnvValue(s, context);
  if (config.type === "http") {
    const c = config as McpServerConfigHttp;
    const url = expand(c.url);
    const headers: Record<string, string> = {};
    if (c.headers) {
      for (const [k, v] of Object.entries(c.headers)) headers[k] = expand(v);
    }
    return { type: "http", url, ...(Object.keys(headers).length > 0 && { headers }) };
  }
  const c = config as McpServerConfigStdio;
  const command = expand(c.command);
  const args = c.args?.map((a) => expand(a)) ?? [];
  const env: Record<string, string> = {};
  if (c.env) {
    for (const [k, v] of Object.entries(c.env)) env[k] = expand(v);
  }
  return {
    ...(c.type && { type: c.type }),
    command,
    ...(args.length > 0 && { args }),
    ...(Object.keys(env).length > 0 && { env }),
  };
}
