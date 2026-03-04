import { spawn } from "node:child_process";
import { z } from "zod";
import type { Tool } from "./types.js";

/** 执行命令输出最大字节数（截断用） */
export const EXECUTE_OUTPUT_LIMIT_BYTES = 32 * 1024; // 32KB

/** 默认允许的可执行名（小写），仅允许列表内命令执行。 */
export const DEFAULT_ALLOWED_COMMANDS = [
  "npm",
  "pnpm",
  "node",
  "npx",
  "yarn",
  "git",
  "tsx",
  "tsc",
] as const;

function getExecutableName(commandStr: string): string {
  const trimmed = commandStr.trim();
  const firstSpace = trimmed.indexOf(" ");
  const firstToken = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  // 去掉路径，只取 basename，例如 /usr/bin/npm -> npm, ./node_modules/.bin/tsx -> tsx
  const slash = firstToken.lastIndexOf("/");
  const base = slash === -1 ? firstToken : firstToken.slice(slash + 1);
  return base.toLowerCase();
}

function isAllowed(executable: string, allowlist: ReadonlyArray<string>): boolean {
  return allowlist.includes(executable.toLowerCase());
}

const argsSchema = z.object({
  command: z.string().min(1, "command is required"),
});

function runWithTimeout(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr) + "\n(command timed out)",
        code: null,
      });
    }, timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr),
        code: code ?? null,
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function truncateOutput(text: string): string {
  const limit = EXECUTE_OUTPUT_LIMIT_BYTES;
  if (Buffer.byteLength(text, "utf-8") <= limit) return text;
  return text.slice(0, limit) + "\n(truncated: output limit exceeded)";
}

export interface ExecuteCommandOptions {
  cwd: string;
  /** 允许的可执行名列表，默认 DEFAULT_ALLOWED_COMMANDS */
  allowedCommands?: ReadonlyArray<string>;
  /** 超时毫秒数，默认 60_000 */
  timeoutMs?: number;
}

export function createExecuteCommandTool(options: ExecuteCommandOptions): Tool {
  const { cwd, allowedCommands = DEFAULT_ALLOWED_COMMANDS, timeoutMs = 60_000 } = options;
  const allowlist = [...allowedCommands];

  return {
    name: "execute_command",
    description:
      "Run a shell command in the workspace root directory. Do not use 'cd'; the command always runs from the workspace root (use -p path or pass paths for tools like tsc). Only whitelisted executables are allowed (e.g. npm, pnpm, node, npx, yarn, git, tsx, tsc). Dangerous commands are rejected. Output is truncated to 32KB. This tool requires user approval when --approval prompt.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "Command line to run from workspace root (e.g. 'git status --porcelain', 'npx tsc --noEmit -p packages/cli/tsconfig.json'). Do not use 'cd'.",
        },
      },
      required: ["command"],
    },
    requiresApproval: true,
    async execute(args: Record<string, unknown>): Promise<string> {
      const parsed = argsSchema.safeParse(args);
      if (!parsed.success) {
        return `Invalid arguments: ${parsed.error.message}`;
      }
      const { command } = parsed.data;
      const executable = getExecutableName(command);
      if (!isAllowed(executable, allowlist)) {
        return `Command not allowed: "${executable}" is not in the allowlist. Allowed: ${allowlist.join(", ")}.`;
      }

      try {
        // shell: true 时 spawn 第一个参数为 shell 命令字符串，args 会被忽略，传空即可；或传 command 与 []
        const { stdout, stderr, code } = await runWithTimeout(command, [], cwd, timeoutMs);
        const out = [stdout, stderr].filter(Boolean).join("\n") || "(no output)";
        if (code !== null && code !== 0) {
          return `exit code ${code}\n${out}`;
        }
        return out;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error executing command: ${message}`;
      }
    },
  };
}
