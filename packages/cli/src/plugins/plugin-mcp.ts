/**
 * 从已加载插件收集 mcpServers 配置，与 Claude Code 插件 MCP 约定一致；
 * 支持 .mcp.json 与 plugin.json 内 mcpServers，占位符 ${PLUGIN_ROOT} 展开为插件根目录。
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { McpServerConfig } from "../config.js";
import { readMcpJsonFromPath, parseOneMcpServerConfig } from "../config.js";
import { expandMcpServerConfig } from "../mcp/env-expand.js";
import type { PluginLoaded } from "./discover.js";

/**
 * 从插件目录读取 plugin.json 中的 mcpServers 字段（若存在）。
 */
async function readManifestMcpServers(pluginDir: string): Promise<Record<string, McpServerConfig> | null> {
  const manifestPath = join(pluginDir, ".claude-plugin", "plugin.json");
  if (!existsSync(manifestPath)) return null;
  try {
    const raw = await readFile(manifestPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const servers = parsed?.mcpServers;
    if (typeof servers !== "object" || servers === null || Array.isArray(servers)) return null;
    const result: Record<string, McpServerConfig> = {};
    for (const [name, entry] of Object.entries(servers)) {
      const c = parseOneMcpServerConfig(entry);
      if (c) result[name] = c;
    }
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

/**
 * 收集所有已加载插件的 MCP 配置并合并；
 * 键为 pluginName__serverName，配置中 ${PLUGIN_ROOT} 展开为插件根路径。
 */
export async function getPluginMcpServers(
  pluginsLoaded: PluginLoaded[]
): Promise<Record<string, McpServerConfig>> {
  const merged: Record<string, McpServerConfig> = {};
  for (const plugin of pluginsLoaded) {
    const context = { PLUGIN_ROOT: plugin.path, CLAUDE_PLUGIN_ROOT: plugin.path };
    const fromMcpJson = await readMcpJsonFromPath(join(plugin.path, ".mcp.json"));
    const fromManifest = await readManifestMcpServers(plugin.path);
    const prefix = `${plugin.name}__`;
    const add = (name: string, cfg: McpServerConfig) => {
      merged[prefix + name] = expandMcpServerConfig(cfg, context);
    };
    if (fromMcpJson) {
      for (const [name, cfg] of Object.entries(fromMcpJson)) add(name, cfg);
    }
    if (fromManifest) {
      for (const [name, cfg] of Object.entries(fromManifest)) add(name, cfg);
    }
  }
  return merged;
}
