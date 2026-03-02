/**
 * memory_write：写入 Auto Memory（追加 MEMORY.md 或写入主题 .md 文件），需批准。
 * PRD §4 Auto Memory。
 */
import { z } from "zod";
import { getProjectId, appendToMemoryMd, writeTopicFile } from "../memory/auto-memory.js";
import type { Tool } from "./types.js";

const argsSchema = z.object({
  content: z.string().min(1, "content is required"),
  topic: z.string().optional(),
});

export interface MemoryWriteToolOptions {
  cwd: string;
  memoryPath?: string;
}

export function createMemoryWriteTool(opts: MemoryWriteToolOptions): Tool {
  const { cwd, memoryPath } = opts;
  return {
    name: "memory_write",
    description:
      "Write to persistent auto memory for this project. Use 'content' only to append to MEMORY.md (session-loaded index). Use 'topic' plus 'content' to write to a topic file (e.g. topic=debugging creates debugging.md). Topic files are loaded on demand when the model reads them. This tool requires user approval when --approval prompt.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Content to write (Markdown). Appended to MEMORY.md or written to topic file." },
        topic: {
          type: "string",
          description: "Optional. If set, write to a topic file (e.g. 'debugging') instead of appending to MEMORY.md.",
        },
      },
      required: ["content"],
    },
    requiresApproval: true,
    async execute(args: Record<string, unknown>): Promise<string> {
      const parsed = argsSchema.safeParse(args);
      if (!parsed.success) {
        return `Invalid arguments: ${parsed.error.message}`;
      }
      const { content, topic } = parsed.data;
      const projectId = getProjectId(cwd);
      try {
        if (topic != null && topic.trim() !== "") {
          const filePath = await writeTopicFile(projectId, topic.trim(), content, memoryPath);
          return `Written to topic file: ${filePath}`;
        }
        const filePath = await appendToMemoryMd(projectId, content, memoryPath);
        return `Appended to MEMORY.md: ${filePath}`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error writing memory: ${message}`;
      }
    },
  };
}
