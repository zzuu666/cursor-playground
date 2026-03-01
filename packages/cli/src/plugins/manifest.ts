import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

/** 插件 manifest 结构，与 Claude Code 文档对齐。 */
export interface PluginManifest {
  /** 必填，用作 skill 命名空间（如 my-plugin:hello）。 */
  name: string;
  description?: string;
  version?: string;
  author?: { name?: string };
}

/**
 * 读取并解析 .claude-plugin/plugin.json。
 * 若文件不存在或 name 无效，返回 null（便于 discover 跳过无效插件）。
 */
export async function readPluginManifest(
  manifestPath: string
): Promise<PluginManifest | null> {
  if (!existsSync(manifestPath)) return null;
  const raw = await readFile(manifestPath, "utf-8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (parsed == null || typeof parsed !== "object") return null;
  const name = parsed.name;
  if (typeof name !== "string" || !name.trim()) return null;
  return {
    name: name.trim(),
    ...(typeof parsed.description === "string" && { description: parsed.description }),
    ...(typeof parsed.version === "string" && { version: parsed.version }),
    ...(parsed.author != null &&
      typeof parsed.author === "object" &&
      !Array.isArray(parsed.author) && {
        author: {
          ...(typeof (parsed.author as Record<string, unknown>).name === "string" && {
            name: (parsed.author as Record<string, unknown>).name as string,
          }),
        },
      }),
  };
}
