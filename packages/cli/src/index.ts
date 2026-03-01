import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { join } from "node:path";
import { Command } from "commander";
import { AgentLoop, type LoopResult } from "./agent/loop.js";
import { DEFAULT_LOOP_POLICY } from "./agent/policy.js";
import { AgentSession } from "./agent/session.js";
import { getMinimaxConfig } from "./config.js";
import { LoopSpinDetectedError } from "./infra/errors.js";
import { redactForLog, writeTranscript } from "./infra/logger.js";
import type { ChatProvider } from "./providers/base.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { MockProvider } from "./providers/mock.js";
import { createGlobSearchTool } from "./tools/glob-search.js";
import { createReadFileTool } from "./tools/read-file.js";
import { ToolRegistry } from "./tools/registry.js";

async function readFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
}

async function loadPrompt(rawPrompt?: string): Promise<string | null> {
  if (rawPrompt != null && rawPrompt.trim().length > 0) {
    return rawPrompt.trim();
  }
  if (input.isTTY) {
    return null;
  }
  const stdinText = await readFromStdin();
  return stdinText.length > 0 ? stdinText : null;
}

function runOneTurn(
  loop: AgentLoop,
  session: AgentSession,
  prompt: string,
  stream: boolean,
  provider: ChatProvider
): Promise<LoopResult> {
  const runOptions =
    stream && provider.streamComplete
      ? { onStreamText: (delta: string) => output.write(delta) }
      : {};
  return loop.run(session, prompt, runOptions);
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("mini-agent")
    .description("Learning-first code agent bootstrap")
    .option("-p, --prompt <text>", "single user prompt (omit for REPL)")
    .option(
      "--provider <name>",
      "LLM provider: minimax | mock",
      "minimax"
    )
    .option("--stream", "stream model output token-by-token")
    .option(
      "-t, --transcript-dir <path>",
      "transcript output directory",
      join(process.cwd(), "transcripts")
    );

  program.parse(process.argv);
  const options = program.opts<{
    prompt?: string;
    provider: string;
    stream: boolean;
    transcriptDir: string;
  }>();

  const registry = new ToolRegistry();
  const workspaceCwd = process.cwd();
  registry.register(createReadFileTool(workspaceCwd));
  registry.register(createGlobSearchTool(workspaceCwd));

  const provider: ChatProvider =
    options.provider === "mock"
      ? new MockProvider()
      : (() => {
          const cfg = getMinimaxConfig();
          const apiTools = registry.list().map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema,
          }));
          return new AnthropicProvider({
            ...cfg,
            tools: apiTools,
            maxRetries: DEFAULT_LOOP_POLICY.maxRetries,
            retryDelayMs: DEFAULT_LOOP_POLICY.retryDelayMs,
          });
        })();

  const session = new AgentSession();
  const loop = new AgentLoop(provider, DEFAULT_LOOP_POLICY, registry);

  const initialPrompt = await loadPrompt(options.prompt);

  if (initialPrompt != null) {
    try {
      const result = await runOneTurn(
        loop,
        session,
        initialPrompt,
        options.stream ?? false,
        provider
      );
      if (!options.stream && result.finalText) {
        output.write(`${result.finalText}\n`);
      }
      if (options.stream) output.write("\n");
      const transcriptPath = await writeTranscript(options.transcriptDir, {
        createdAt: new Date().toISOString(),
        provider: provider.name,
        policy: DEFAULT_LOOP_POLICY,
        messages: session.getMessages(),
        result: {
          turns: result.turns,
          toolCalls: result.toolCalls,
          diagnostics: result.diagnostics,
          elapsedTotalMs: result.elapsedTotalMs,
        },
      });
      output.write(
        `turns=${result.turns}, toolCalls=${result.toolCalls}, elapsed=${result.elapsedTotalMs}ms\ntranscript=${transcriptPath}\n`
      );
    } catch (err) {
      if (err instanceof LoopSpinDetectedError) {
        const transcriptPath = await writeTranscript(options.transcriptDir, {
          createdAt: new Date().toISOString(),
          provider: provider.name,
          policy: DEFAULT_LOOP_POLICY,
          messages: session.getMessages(),
          meta: { spinDetected: true },
        });
        process.stderr.write(
          `error: ${err.message}\ntranscript=${transcriptPath}\n`
        );
      } else {
        throw err;
      }
      process.exitCode = 1;
    }
    return;
  }

  if (!input.isTTY) {
    process.stderr.write("mini-agent failed: Please pass --prompt or run in TTY for REPL.\n");
    process.exitCode = 1;
    return;
  }

  const rl = createInterface({ input, output });
  output.write("mini-agent REPL (empty line to exit)\n");

  for (;;) {
    const line = await new Promise<string>((resolve) => {
      rl.question("> ", resolve);
    });
    const prompt = line.trim();
    if (prompt.length === 0) break;
    try {
      const result = await runOneTurn(
        loop,
        session,
        prompt,
        options.stream ?? false,
        provider
      );
      if (!options.stream && result.finalText) {
        output.write(`${result.finalText}\n`);
      }
      if (options.stream) output.write("\n");
      output.write(
        `[turns=${result.turns}, toolCalls=${result.toolCalls}, elapsed=${result.elapsedTotalMs}ms]\n`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`error: ${msg}\n`);
      if (err instanceof LoopSpinDetectedError) {
        const transcriptPath = await writeTranscript(options.transcriptDir, {
          createdAt: new Date().toISOString(),
          provider: provider.name,
          policy: DEFAULT_LOOP_POLICY,
          messages: session.getMessages(),
          meta: { spinDetected: true },
        });
        process.stderr.write(`transcript=${transcriptPath}\n`);
      }
    }
  }

  const transcriptPath = await writeTranscript(options.transcriptDir, {
    createdAt: new Date().toISOString(),
    provider: provider.name,
    policy: DEFAULT_LOOP_POLICY,
    messages: session.getMessages(),
  });
  output.write(`transcript=${transcriptPath}\n`);
  rl.close();
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown error during startup.";
  process.stderr.write(`mini-agent failed: ${redactForLog(message)}\n`);
  process.exitCode = 1;
});
