import { stdin as input } from "node:process";
import { join } from "node:path";
import { Command } from "commander";
import { AgentLoop } from "./agent/loop.js";
import { DEFAULT_LOOP_POLICY } from "./agent/policy.js";
import { AgentSession } from "./agent/session.js";
import { writeTranscript } from "./infra/logger.js";
import { MockProvider } from "./providers/mock.js";

async function readFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
}

async function loadPrompt(rawPrompt?: string): Promise<string> {
  if (rawPrompt && rawPrompt.trim().length > 0) {
    return rawPrompt.trim();
  }

  if (input.isTTY) {
    throw new Error("Please pass --prompt or pipe input to stdin.");
  }

  const stdinText = await readFromStdin();
  if (!stdinText) {
    throw new Error("No input detected from stdin.");
  }
  return stdinText;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("mini-agent")
    .description("Learning-first code agent bootstrap")
    .option("-p, --prompt <text>", "single user prompt")
    .option(
      "-t, --transcript-dir <path>",
      "transcript output directory",
      join(process.cwd(), "transcripts")
    );

  program.parse(process.argv);
  const options = program.opts<{
    prompt?: string;
    transcriptDir: string;
  }>();

  const prompt = await loadPrompt(options.prompt);
  const provider = new MockProvider();
  const session = new AgentSession();
  const loop = new AgentLoop(provider, DEFAULT_LOOP_POLICY);
  const result = await loop.run(session, prompt);

  if (result.finalText) {
    process.stdout.write(`${result.finalText}\n`);
  } else {
    process.stdout.write("No text response from provider.\n");
  }

  const transcriptPath = await writeTranscript(options.transcriptDir, {
    createdAt: new Date().toISOString(),
    provider: provider.name,
    policy: DEFAULT_LOOP_POLICY,
    messages: session.getMessages(),
  });

  process.stdout.write(
    `turns=${result.turns}, toolCalls=${result.toolCalls}\ntranscript=${transcriptPath}\n`
  );
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown error during startup.";
  process.stderr.write(`mini-agent failed: ${message}\n`);
  process.exitCode = 1;
});
