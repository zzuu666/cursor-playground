import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { join } from "node:path";
import { Command } from "commander";
import { AgentLoop } from "./agent/loop.js";
import { DEFAULT_LOOP_POLICY } from "./agent/policy.js";
import { AgentSession } from "./agent/session.js";
import { getMinimaxConfig } from "./config.js";
import { redactForLog, writeTranscript } from "./infra/logger.js";
import type { ChatProvider } from "./providers/base.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { MockProvider } from "./providers/mock.js";

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
): Promise<{ finalText: string; turns: number; toolCalls: number }> {
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

  const provider: ChatProvider =
    options.provider === "mock"
      ? new MockProvider()
      : (() => {
          const cfg = getMinimaxConfig();
          return new AnthropicProvider(cfg);
        })();

  const session = new AgentSession();
  const loop = new AgentLoop(provider, DEFAULT_LOOP_POLICY);

  const initialPrompt = await loadPrompt(options.prompt);

  if (initialPrompt != null) {
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
    });
    output.write(
      `turns=${result.turns}, toolCalls=${result.toolCalls}\ntranscript=${transcriptPath}\n`
    );
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
      output.write(`[turns=${result.turns}]\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`error: ${msg}\n`);
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
