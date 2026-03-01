import { copyFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { z } from "zod";
import { resolveWithinCwd } from "./safe-path.js";
import type { Tool } from "./types.js";

const argsSchema = z.object({
  path: z.string().min(1, "path is required"),
  content: z.string(),
  backup: z.boolean().optional(),
});

export function createWriteFileTool(cwd: string): Tool {
  return {
    name: "write_file",
    description:
      "Write content to a text file. Path is relative to the workspace. Only paths inside the workspace are allowed. If the file exists and backup is true, it will be backed up to {path}.bak before writing. This tool requires user approval when --approval prompt.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to the file from workspace root" },
        content: { type: "string", description: "Content to write (UTF-8)" },
        backup: { type: "boolean", description: "If true and file exists, backup to path.bak before overwriting" },
      },
      required: ["path", "content"],
    },
    requiresApproval: true,
    async execute(args: Record<string, unknown>): Promise<string> {
      const parsed = argsSchema.safeParse(args);
      if (!parsed.success) {
        return `Invalid arguments: ${parsed.error.message}`;
      }
      const { path: relativePath, content, backup } = parsed.data;
      const { path: absPath, error: pathError } = resolveWithinCwd(relativePath, cwd);
      if (pathError) return pathError;

      try {
        if (backup === true && existsSync(absPath)) {
          const bakPath = `${absPath}.bak`;
          await copyFile(absPath, bakPath);
          await writeFile(absPath, content, "utf-8");
          return `Written ${absPath}; existing file backed up to ${bakPath}.`;
        }
        await writeFile(absPath, content, "utf-8");
        return `Written ${absPath}.`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error writing file: ${message}`;
      }
    },
  };
}
