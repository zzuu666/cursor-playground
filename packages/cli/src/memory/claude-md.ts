/**
 * CLAUDE.md 发现与合并：项目 / 用户 / 本地，带来源标记。
 * PRD §3：docs/issues/008-memory-prd.md
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ClaudeMdLoadedEntry, ClaudeMdMerged, ClaudeMdSource } from "./types.js";

const CLAUDE_MD = "CLAUDE.md";
const CLAUDE_LOCAL_MD = "CLAUDE.local.md";

export interface ClaudeMdPathEntry {
  path: string;
  source: ClaudeMdSource;
}

/**
 * 发现可能存在的 CLAUDE.md 路径（不读内容）。
 * 顺序：project（.claude/CLAUDE.md 优先于根目录 CLAUDE.md）、user、local。
 */
export function findClaudeMdPaths(cwd: string): ClaudeMdPathEntry[] {
  const home = homedir();
  const out: ClaudeMdPathEntry[] = [];

  const projectClaudeDir = join(cwd, ".claude", CLAUDE_MD);
  const projectRoot = join(cwd, CLAUDE_MD);
  if (existsSync(projectClaudeDir)) out.push({ path: projectClaudeDir, source: "project" });
  if (existsSync(projectRoot)) out.push({ path: projectRoot, source: "project" });

  const userPath = join(home, ".claude", CLAUDE_MD);
  if (existsSync(userPath)) out.push({ path: userPath, source: "user" });

  const localPath = join(cwd, CLAUDE_LOCAL_MD);
  if (existsSync(localPath)) out.push({ path: localPath, source: "local" });

  return out;
}

/** 判断路径是否被排除（excludes 中为路径前缀或精确匹配，均先 resolve）。 */
function isExcluded(filePath: string, excludes: string[], cwd: string): boolean {
  const absPath = resolve(filePath);
  for (const ex of excludes) {
    const absEx = ex.startsWith("~") ? join(homedir(), ex.slice(1)) : resolve(cwd, ex);
    if (absPath === absEx || absPath.startsWith(absEx + "/")) return true;
  }
  return false;
}

/**
 * 加载指定路径的 CLAUDE.md 内容，并过滤掉被排除的路径。
 */
export async function loadClaudeMdContent(
  pathEntries: ClaudeMdPathEntry[],
  excludes: string[],
  cwd: string
): Promise<ClaudeMdLoadedEntry[]> {
  const results: ClaudeMdLoadedEntry[] = [];
  for (const { path, source } of pathEntries) {
    if (excludes.length > 0 && isExcluded(path, excludes, cwd)) continue;
    try {
      const content = await readFile(path, "utf-8");
      const lineCount = content.split(/\n/).length;
      const entry: ClaudeMdLoadedEntry = { path, source, content: content.trim() };
      if (lineCount > 0) entry.lineCount = lineCount;
      results.push(entry);
    } catch {
      // 单文件读失败则跳过，不拖垮整体
    }
  }
  return results;
}

/**
 * 将多条 CLAUDE.md 合并为带来源标记的单一文本，供注入 system prompt。
 */
export function mergeAndTag(entries: ClaudeMdLoadedEntry[]): ClaudeMdMerged {
  const parts: string[] = [];
  for (const { path, source, content } of entries) {
    if (!content) continue;
    parts.push(`[CLAUDE.md: ${source}]\n${content}`);
  }
  return {
    text: parts.join("\n\n"),
    entries: entries.map((e) => {
      const out: ClaudeMdLoadedEntry = { path: e.path, source: e.source, content: e.content };
      if (e.lineCount != null) out.lineCount = e.lineCount;
      return out;
    }),
  };
}
