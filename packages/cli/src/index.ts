import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";
import { AgentLoop, type LoopResult } from "./agent/loop.js";
import { AgentSession } from "./agent/session.js";
import { getMinimaxConfig, loadConfig, type ResolvedConfig } from "./config.js";
import { EXIT_BUSINESS, EXIT_CONFIG } from "./infra/exit-codes.js";
import { LoopLimitError, LoopSpinDetectedError } from "./infra/errors.js";
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
  opts: { stream: boolean; verbose: boolean },
  provider: ChatProvider
): Promise<LoopResult> {
  const runOptions: { onStreamText?: (delta: string) => void; verbose?: boolean } = {
    verbose: opts.verbose,
  };
  if (opts.stream && provider.streamComplete) {
    runOptions.onStreamText = (delta: string) => output.write(delta);
  }
  return loop.run(session, prompt, runOptions);
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("mini-agent")
    .description("Learning-first code agent bootstrap")
    .option("-p, --prompt <text>", "single user prompt (omit for REPL)")
    .option("--config <path>", "path to config file (default: look for mini-agent.config.json or .mini-agent.json in cwd)")
    .option("--provider <name>", "LLM provider: minimax | mock", "minimax")
    .option("--model <name>", "model name (overrides config/env)")
    .option("--stream", "stream model output token-by-token")
    .option("-t, --transcript-dir <path>", "transcript output directory")
    .option("--verbose", "print per-turn request/response summary and tool in/out lengths")
    .option("--dry-run", "only print prompt and tool list, do not call LLM or tools");

  program.parse(process.argv);
  const opts = program.opts<{
    prompt?: string;
    config?: string;
    provider: string;
    model?: string;
    stream: boolean;
    transcriptDir?: string;
    verbose: boolean;
    dryRun: boolean;
  }>();

  let resolved: ResolvedConfig;
  try {
    const cliOverrides: Parameters<typeof loadConfig>[0]["cli"] = {
      provider: opts.provider,
      verbose: opts.verbose ?? false,
      dryRun: opts.dryRun ?? false,
    };
    if (opts.model != null) cliOverrides.model = opts.model;
    if (opts.transcriptDir != null) cliOverrides.transcriptDir = opts.transcriptDir;
    resolved = await loadConfig({
      ...(opts.config != null && { configPath: opts.config }),
      cwd: process.cwd(),
      cli: cliOverrides,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`mini-agent config error: ${redactForLog(message)}\n`);
    process.exitCode = EXIT_CONFIG;
    return;
  }

  const registry = new ToolRegistry();
  const workspaceCwd = process.cwd();
  registry.register(createReadFileTool(workspaceCwd));
  registry.register(createGlobSearchTool(workspaceCwd));

  const initialPrompt = await loadPrompt(opts.prompt);

  if (resolved.dryRun) {
    process.stderr.write(`[dry-run] prompt: ${initialPrompt ?? "(none)"}\n`);
    process.stderr.write(`[dry-run] tools: ${registry.list().map((t) => t.name).join(", ") || "none"}\n`);
    return;
  }

  let provider: ChatProvider;
  if (resolved.provider === "mock") {
    provider = new MockProvider();
  } else {
    try {
      const cfg = getMinimaxConfig(resolved);
      const apiTools = registry.list().map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
      provider = new AnthropicProvider({
        ...cfg,
        tools: apiTools,
        maxRetries: resolved.policy.maxRetries,
        retryDelayMs: resolved.policy.retryDelayMs,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`mini-agent config error: ${redactForLog(message)}\n`);
      process.exitCode = EXIT_CONFIG;
      return;
    }
  }

  const session = new AgentSession();
  const loop = new AgentLoop(provider, resolved.policy, registry);

  if (initialPrompt != null) {
    try {
      const result = await runOneTurn(
        loop,
        session,
        initialPrompt,
        { stream: opts.stream ?? false, verbose: resolved.verbose },
        provider
      );
      if (!opts.stream && result.finalText) {
        output.write(`${result.finalText}\n`);
      }
      if (opts.stream) output.write("\n");
      const transcriptPath = await writeTranscript(resolved.transcriptDir, {
        createdAt: new Date().toISOString(),
        provider: provider.name,
        policy: resolved.policy,
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
      if (err instanceof LoopSpinDetectedError || err instanceof LoopLimitError) {
        const transcriptPath = await writeTranscript(resolved.transcriptDir, {
          createdAt: new Date().toISOString(),
          provider: provider.name,
          policy: resolved.policy,
          messages: session.getMessages(),
          ...(err instanceof LoopSpinDetectedError && { meta: { spinDetected: true } }),
        });
        process.stderr.write(
          `error: ${err.message}\ntranscript=${transcriptPath}\n`
        );
      } else {
        throw err;
      }
      process.exitCode = EXIT_BUSINESS;
    }
    return;
  }

  if (!input.isTTY) {
    process.stderr.write("mini-agent failed: Please pass --prompt or run in TTY for REPL.\n");
    process.exitCode = EXIT_BUSINESS;
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
        { stream: opts.stream ?? false, verbose: resolved.verbose },
        provider
      );
      if (!opts.stream && result.finalText) {
        output.write(`${result.finalText}\n`);
      }
      if (opts.stream) output.write("\n");
      output.write(
        `[turns=${result.turns}, toolCalls=${result.toolCalls}, elapsed=${result.elapsedTotalMs}ms]\n`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`error: ${msg}\n`);
      if (err instanceof LoopSpinDetectedError) {
        const transcriptPath = await writeTranscript(resolved.transcriptDir, {
          createdAt: new Date().toISOString(),
          provider: provider.name,
          policy: resolved.policy,
          messages: session.getMessages(),
          meta: { spinDetected: true },
        });
        process.stderr.write(`transcript=${transcriptPath}\n`);
      }
      process.exitCode = EXIT_BUSINESS;
    }
  }

  const transcriptPath = await writeTranscript(resolved.transcriptDir, {
    createdAt: new Date().toISOString(),
    provider: provider.name,
    policy: resolved.policy,
    messages: session.getMessages(),
  });
  output.write(`transcript=${transcriptPath}\n`);
  rl.close();
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown error during startup.";
  process.stderr.write(`mini-agent failed: ${redactForLog(message)}\n`);
  process.exitCode = EXIT_BUSINESS;
});
