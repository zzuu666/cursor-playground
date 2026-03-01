import { resolve, normalize, relative } from "node:path";

/**
 * Resolve a relative path within cwd. Returns the absolute path if safe, or an error message.
 * Rejects paths that escape the workspace (e.g. ".." or absolute paths outside cwd).
 */
export function resolveWithinCwd(
  relativePath: string,
  cwd: string
): { path: string; error?: string } {
  const base = resolve(cwd);
  const abs = resolve(base, normalize(relativePath));
  const rel = relative(base, abs);
  if (rel.startsWith("..")) {
    return { path: "", error: "path must be inside workspace (no .. or absolute outside cwd)" };
  }
  return { path: abs };
}

/** Maximum bytes for a single tool result (avoid token overflow). */
export const MAX_TOOL_OUTPUT_BYTES = 8 * 1024; // 8KB

export function truncateToLimit(text: string, limitBytes: number = MAX_TOOL_OUTPUT_BYTES): string {
  if (Buffer.byteLength(text, "utf-8") <= limitBytes) return text;
  return text.slice(0, limitBytes) + "\n(truncated: output limit exceeded)";
}
