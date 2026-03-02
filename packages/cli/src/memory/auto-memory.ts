/**
 * Auto Memory：按项目存储于 ~/.claude/projects/<projectId>/memory/，
 * 仅 MEMORY.md 前 N 行每会话加载。PRD §4。
 */
import { readFile, mkdir, appendFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ProjectId } from "./types.js";

const MEMORY_DIR_BASE = ".claude";
const PROJECTS_DIR = "projects";
const MEMORY_MD = "MEMORY.md";
const DEFAULT_MAX_LINES = 200;

/**
 * 解析项目标识：优先 git 根路径的稳定 hash，无 git 时用 cwd 的规范路径 hash。
 */
export function getProjectId(cwd: string): ProjectId {
  let basePath: string;
  try {
    const gitRoot = execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      cwd,
    }).trim();
    basePath = resolve(gitRoot);
  } catch {
    basePath = resolve(cwd);
  }
  return createHash("sha256").update(basePath).digest("hex").slice(0, 16);
}

/**
 * 返回该项目的 Auto Memory 目录绝对路径。
 * 若传入 memoryPath 覆盖则作为 projects 的父目录根（即 memoryPath 替代 ~/.claude）。
 */
export function getAutoMemoryDir(projectId: ProjectId, memoryPathOverride?: string): string {
  const base = memoryPathOverride ?? join(homedir(), MEMORY_DIR_BASE);
  return join(base, PROJECTS_DIR, projectId, "memory");
}

/**
 * 读取 MEMORY.md 的前 maxLines 行（不足则全部返回）。
 */
export async function readMemoryMdFirstN(
  memoryDir: string,
  maxLines: number = DEFAULT_MAX_LINES
): Promise<{ content: string; lineCount: number }> {
  const filePath = join(memoryDir, MEMORY_MD);
  if (!existsSync(filePath)) {
    return { content: "", lineCount: 0 };
  }
  const raw = await readFile(filePath, "utf-8");
  const lines = raw.split(/\n/);
  const lineCount = lines.length;
  const take = Math.min(lines.length, maxLines);
  const content = lines.slice(0, take).join("\n").trim();
  return { content, lineCount };
}

/**
 * 获取用于注入的 Auto Memory 片段（[Memory: auto] 前缀 + MEMORY.md 前 maxLines 行）。
 */
export async function getAutoMemoryFragment(
  projectId: ProjectId,
  maxLines: number,
  memoryPathOverride?: string
): Promise<{ fragment: string; lineCount: number; path: string }> {
  const memoryDir = getAutoMemoryDir(projectId, memoryPathOverride);
  const { content, lineCount } = await readMemoryMdFirstN(memoryDir, maxLines);
  const fragment = content ? `[Memory: auto]\n${content}` : "";
  return { fragment, lineCount, path: join(memoryDir, MEMORY_MD) };
}

/**
 * 追加内容到 MEMORY.md；若文件或目录不存在则创建。
 */
export async function appendToMemoryMd(
  projectId: ProjectId,
  content: string,
  memoryPathOverride?: string
): Promise<string> {
  const memoryDir = getAutoMemoryDir(projectId, memoryPathOverride);
  await mkdir(memoryDir, { recursive: true });
  const filePath = join(memoryDir, MEMORY_MD);
  const block = content.trim();
  const toAppend = block.endsWith("\n") ? block : block + "\n";
  await appendFile(filePath, toAppend, "utf-8");
  return filePath;
}

/**
 * 写入主题文件（如 debugging.md）到 memory 目录。
 */
export async function writeTopicFile(
  projectId: ProjectId,
  topic: string,
  content: string,
  memoryPathOverride?: string
): Promise<string> {
  const memoryDir = getAutoMemoryDir(projectId, memoryPathOverride);
  await mkdir(memoryDir, { recursive: true });
  const safeName = topic.replace(/[^a-zA-Z0-9_-]/g, "_") || "topic";
  const fileName = safeName.endsWith(".md") ? safeName : `${safeName}.md`;
  const filePath = join(memoryDir, fileName);
  await writeFile(filePath, content.trimEnd() + "\n", "utf-8");
  return filePath;
}
