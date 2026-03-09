import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";

/** 约定目录内识别的 Skill 文件名 */
const SKILL_FILE_NAMES = ["SKILL.md", "skill.json"] as const;

/** 单条 Skill 加载结果，含路径、内容与字符数（供 transcript/verbose 使用） */
export interface SkillEntry {
  path: string;
  content: string;
  charCount: number;
  /** Slash-invocable name parsed from frontmatter `name` field, or derived from directory/file name. */
  name?: string;
  /** Short description parsed from frontmatter `description` field. */
  description?: string;
}

interface ParsedSkillMd {
  content: string;
  name?: string;
  description?: string;
}

/**
 * 从 SKILL.md 文本解析出 name、description（来自 frontmatter）与 body，拼接为 content。
 * 若无 frontmatter，整文件作为 content。
 */
function parseSkillMd(raw: string): ParsedSkillMd {
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/);
  if (!match) return { content: raw.trim() };

  const frontmatter = match[1];
  const body = match[2];
  if (frontmatter == null || body == null) return { content: raw.trim() };

  let name: string | undefined;
  let description: string | undefined;

  const nameMatch = frontmatter.match(/^name\s*:\s*(.+)$/m);
  if (nameMatch?.[1]) {
    name = nameMatch[1].trim().replace(/^["']|["']$/g, "") || undefined;
  }

  const descMatch = frontmatter.match(/^description\s*:\s*(.+)$/m);
  if (descMatch?.[1]) {
    description = descMatch[1].trim().replace(/^["']|["']$/g, "") || undefined;
  }

  const parts: string[] = [];
  if (description) parts.push(description);
  if (body.trim()) parts.push(body.trim());

  return {
    content: parts.join("\n\n"),
    ...(name != null && { name }),
    ...(description != null && { description }),
  };
}

/**
 * 从 skill.json 解析出 systemPromptAddition 或 description，拼接为 content。
 */
function parseSkillJson(raw: string): string {
  const obj = JSON.parse(raw) as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof obj.systemPromptAddition === "string" && obj.systemPromptAddition.trim()) {
    parts.push(obj.systemPromptAddition.trim());
  }
  if (typeof obj.description === "string" && obj.description.trim()) {
    parts.push(obj.description.trim());
  }
  return parts.join("\n\n") || "";
}

/**
 * 加载单个文件为 Skill 条目。path 为绝对路径，displayPath 用于来源标记（可为相对路径）。
 * fallbackName 用于当 frontmatter 未指定 name 时的回退名称（通常为目录名）。
 */
async function loadOneFile(
  absolutePath: string,
  displayPath: string,
  fallbackName?: string
): Promise<SkillEntry | null> {
  if (!existsSync(absolutePath)) return null;
  const raw = await readFile(absolutePath, "utf-8");
  const ext = absolutePath.endsWith(".json") ? "json" : "md";
  if (ext === "json") {
    const content = parseSkillJson(raw);
    if (!content) return null;
    return {
      path: displayPath, content, charCount: content.length,
      ...(fallbackName != null && { name: fallbackName }),
    };
  }
  const parsed = parseSkillMd(raw);
  if (!parsed.content) return null;
  const skillName = parsed.name ?? fallbackName;
  return {
    path: displayPath,
    content: parsed.content,
    charCount: parsed.content.length,
    ...(skillName != null && { name: skillName }),
    ...(parsed.description != null && { description: parsed.description }),
  };
}

/**
 * 扫描目录下约定文件（SKILL.md、skill.json），逐个加载。
 */
async function loadFromDir(
  dirPath: string,
  displayPath: string
): Promise<SkillEntry[]> {
  if (!existsSync(dirPath)) return [];
  const entries = await readdir(dirPath, { withFileTypes: true });
  const results: SkillEntry[] = [];
  const dirBaseName = dirPath.split("/").pop() ?? dirPath;
  for (const name of SKILL_FILE_NAMES) {
    const found = entries.find((e) => e.isFile() && e.name === name);
    if (found) {
      const abs = join(dirPath, found.name);
      const entry = await loadOneFile(abs, `${displayPath}/${found.name}`, dirBaseName);
      if (entry) results.push(entry);
    }
  }
  return results;
}

/**
 * 从单个全局根目录加载 Skills：仅处理子目录，每个子目录内查找 SKILL.md 或 skill.json。
 * pathPrefix 用于 transcript 来源标记，如 "agents" 或 "cursor"。
 */
export async function loadGlobalSkillsFromRoot(
  rootDir: string,
  pathPrefix: string
): Promise<SkillEntry[]> {
  if (!existsSync(rootDir)) return [];
  const entries = await readdir(rootDir, { withFileTypes: true });
  const results: SkillEntry[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const subDir = join(rootDir, e.name);
    for (const name of SKILL_FILE_NAMES) {
      const abs = join(subDir, name);
      if (!existsSync(abs)) continue;
      const displayPath = `${pathPrefix}:${e.name}`;
      const entry = await loadOneFile(abs, displayPath, e.name);
      if (entry) {
        results.push(entry);
        break;
      }
    }
  }
  return results;
}

/**
 * 从插件根目录加载 Skills：扫描 pluginRoot/skills/ 下子目录，每个子目录内 SKILL.md 或 skill.json，
 * 来源标记为 pluginName:子目录名（与 Claude Code 命名空间一致）。
 */
export async function loadSkillsFromPluginRoot(
  pluginRoot: string,
  pluginName: string
): Promise<SkillEntry[]> {
  const skillsDir = join(pluginRoot, "skills");
  if (!existsSync(skillsDir)) return [];
  const st = await stat(skillsDir).catch(() => null);
  if (!st?.isDirectory()) return [];
  return loadGlobalSkillsFromRoot(skillsDir, pluginName);
}

function derivePathPrefix(rootDir: string): string {
  if (rootDir.includes(".agents")) return "agents";
  if (rootDir.includes(".cursor")) return "cursor";
  return "global";
}

/**
 * 从多个全局根目录依次加载 Skills，按顺序合并（先 .agents 后 .cursor 等）。
 * globalSkillDirs 为已解析的绝对路径；pathPrefix 按目录名推导，如 ".agents/skills" -> "agents"，".cursor/skills" -> "cursor"。
 */
export async function loadAllGlobalSkills(
  globalSkillDirs: string[]
): Promise<SkillEntry[]> {
  const results: SkillEntry[] = [];
  for (const rootDir of globalSkillDirs) {
    const pathPrefix = derivePathPrefix(rootDir);
    const entries = await loadGlobalSkillsFromRoot(rootDir, pathPrefix);
    results.push(...entries);
  }
  return results;
}

/**
 * 根据 skillPaths 加载所有 Skill：每项为文件则按扩展名解析，为目录则扫描 SKILL.md / skill.json。
 * 返回 path（用于来源标记）、content、charCount 列表。
 */
export async function loadSkills(
  skillPaths: string[],
  cwd: string
): Promise<SkillEntry[]> {
  const results: SkillEntry[] = [];
  for (const p of skillPaths) {
    const absolute = resolve(cwd, p);
    if (!existsSync(absolute)) continue;
    const st = await stat(absolute);
    if (st.isFile()) {
      const lower = absolute.toLowerCase();
      if (lower.endsWith(".json") || lower.endsWith(".md")) {
        const fallback = basename(absolute).replace(/\.(md|json)$/i, "");
        const entry = await loadOneFile(absolute, p, fallback);
        if (entry) results.push(entry);
      }
    } else if (st.isDirectory()) {
      const fromDir = await loadFromDir(absolute, p);
      results.push(...fromDir);
    }
  }
  return results;
}
