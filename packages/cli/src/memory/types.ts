/**
 * Phase 12 Memory 类型定义：CLAUDE.md 来源、Auto Memory、项目 ID。
 * 参见 docs/issues/008-memory-prd.md 与 plan Phase 12。
 */

/** CLAUDE.md 加载来源：项目、用户、本地（不入库）。 */
export type ClaudeMdSource = "project" | "user" | "local";

/** 单条 CLAUDE.md 加载结果，带路径与来源，供合并与 transcript 使用。 */
export interface ClaudeMdLoadedEntry {
  path: string;
  source: ClaudeMdSource;
  content: string;
  lineCount?: number;
}

/** 合并并打标签后的 CLAUDE.md 片段（用于注入 system prompt）。 */
export interface ClaudeMdMerged {
  /** 带 [CLAUDE.md: source] 标记的合并文本。 */
  text: string;
  /** 各文件加载信息，供 transcript 的 claudeMdLoaded。 */
  entries: ClaudeMdLoadedEntry[];
}

/** 项目标识：用于派生 Auto Memory 目录 ~/.claude/projects/<projectId>/memory/。 */
export type ProjectId = string;

/** Auto Memory 加载结果，供 transcript 的 autoMemoryLoaded。 */
export interface AutoMemoryLoadedInfo {
  enabled: boolean;
  lineCount: number;
  charCount?: number;
  path?: string;
}
