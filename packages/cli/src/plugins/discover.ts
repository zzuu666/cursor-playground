import { stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SkillEntry } from "../skills/load.js";
import { loadSkillsFromPluginRoot } from "../skills/load.js";
import { readPluginManifest } from "./manifest.js";

export interface PluginLoaded {
  path: string;
  name: string;
}

/**
 * 从 pluginDirs 发现插件并加载其 skills。
 * 返回合并后的 skillEntries（path 为 pluginName:skillName）与已加载插件列表。
 */
export async function discoverPlugins(
  pluginDirs: string[],
  cwd: string
): Promise<{ skillEntries: SkillEntry[]; pluginsLoaded: PluginLoaded[] }> {
  const skillEntries: SkillEntry[] = [];
  const pluginsLoaded: PluginLoaded[] = [];

  for (const dir of pluginDirs) {
    const pluginDir = resolve(cwd, dir);
    if (!existsSync(pluginDir)) continue;
    const st = await stat(pluginDir).catch(() => null);
    if (!st?.isDirectory()) continue;

    const manifestPath = join(pluginDir, ".claude-plugin", "plugin.json");
    const manifest = await readPluginManifest(manifestPath);
    if (manifest == null) continue;

    const entries = await loadSkillsFromPluginRoot(pluginDir, manifest.name);
    skillEntries.push(...entries);
    pluginsLoaded.push({ path: pluginDir, name: manifest.name });
  }

  return { skillEntries, pluginsLoaded };
}
