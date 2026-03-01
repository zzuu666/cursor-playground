import { glob } from "glob";
import { z } from "zod";
import { truncateToLimit } from "./safe-path.js";
import type { Tool } from "./types.js";

const argsSchema = z.object({
  pattern: z.string().min(1, "pattern is required"),
});

export function createGlobSearchTool(cwd: string): Tool {
  return {
    name: "glob_search",
    description:
      "Search for files matching a glob pattern (e.g. '*.ts', 'src/**/*.ts'). Pattern is resolved inside the workspace only. Returns a list of relative paths, one per line.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern (e.g. *.ts, **/*.json)" },
      },
      required: ["pattern"],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const parsed = argsSchema.safeParse(args);
      if (!parsed.success) {
        return `Invalid arguments: ${parsed.error.message}`;
      }
      const { pattern } = parsed.data;
      if (pattern.includes("..")) {
        return "pattern must not contain '..' (search is limited to workspace)";
      }
      try {
        const matches = await glob(pattern, { cwd, nodir: true });
        const lines = matches.slice(0, 500).map((p) => p);
        let out = lines.join("\n");
        if (matches.length > 500) {
          out += `\n(truncated: showing first 500 of ${matches.length} matches)`;
        }
        return truncateToLimit(out || "(no matches)");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error searching: ${message}`;
      }
    },
  };
}
