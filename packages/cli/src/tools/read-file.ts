import { readFile } from "node:fs/promises";
import { z } from "zod";
import { resolveWithinCwd, truncateToLimit } from "./safe-path.js";
import type { Tool } from "./types.js";

const argsSchema = z.object({
  path: z.string().min(1, "path is required"),
});

export function createReadFileTool(cwd: string): Tool {
  return {
    name: "read_file",
    readOnly: true,
    description:
      "Read the contents of a text file. Path is relative to the workspace (current working directory). Only paths inside the workspace are allowed (no '..' or absolute paths outside cwd).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to the file from workspace root" },
      },
      required: ["path"],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const parsed = argsSchema.safeParse(args);
      if (!parsed.success) {
        return `Invalid arguments: ${parsed.error.message}`;
      }
      const { path: relativePath } = parsed.data;
      const { path: absPath, error: pathError } = resolveWithinCwd(relativePath, cwd);
      if (pathError) return pathError;
      try {
        const content = await readFile(absPath, "utf-8");
        return truncateToLimit(content);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error reading file: ${message}`;
      }
    },
  };
}
