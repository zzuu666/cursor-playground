import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import { Command } from "commander";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };
import { AgentLoop, type LoopResult } from "./agent/loop.js";
import { AgentSession } from "./agent/session.js";
import { loadConfig, type ResolvedConfig } from "./config.js";
import { EXIT_BUSINESS, EXIT_CONFIG } from "./infra/exit-codes.js";
import { LoopLimitError, LoopSpinDetectedError } from "./infra/errors.js";
import {
  appendErrorLog,
  createSessionId,
  clearSessionId,
  redactForLog,
  setSessionId,
  writeTranscript,
} from "./infra/logger.js";
import type { ChatProvider } from "./providers/base.js";
import { createProvider, parseProviderId } from "./providers/factory.js";
import { discoverPlugins } from "./plugins/discover.js";
import { getPluginMcpServers } from "./plugins/plugin-mcp.js";
import { connectAndListTools } from "./mcp/client.js";
import { createToolAdapters } from "./mcp/adapter.js";
import { buildSystemPrompt } from "./skills/build-system-prompt.js";
import { loadAllGlobalSkills, loadSkills } from "./skills/load.js";
import { createExecuteCommandTool } from "./tools/execute-command.js";
import { createGlobSearchTool } from "./tools/glob-search.js";
import { createReadFileTool } from "./tools/read-file.js";
import { createWriteFileTool } from "./tools/write-file.js";
import { createMemoryWriteTool } from "./tools/memory-write.js";
import { ToolRegistry } from "./tools/registry.js";
import { SYSTEM_PROMPT } from "./prompts/system.js";
import { findClaudeMdPaths, loadClaudeMdContent, mergeAndTag } from "./memory/claude-md.js";
import { getProjectId, getAutoMemoryFragment } from "./memory/auto-memory.js";

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

type RunOneTurnOpts = {
  stream: boolean;
  verbose: boolean;
  approvalMode: ResolvedConfig["approval"];
  onApprovalRequest?: (toolName: string, inputSummary: string) => Promise<{ approved: boolean; reason?: string }>;
  getMemoryFragment?: () => Promise<string>;
};

function runOneTurn(
  loop: AgentLoop,
  session: AgentSession,
  prompt: string,
  opts: RunOneTurnOpts,
  provider: ChatProvider
): Promise<LoopResult> {
  const runOptions = {
    verbose: opts.verbose,
    approvalMode: opts.approvalMode,
    ...(opts.onApprovalRequest != null && { onApprovalRequest: opts.onApprovalRequest }),
    ...(opts.stream && provider.streamComplete && { onStreamText: (delta: string) => output.write(delta) }),
    ...(opts.getMemoryFragment != null && { getMemoryFragment: opts.getMemoryFragment }),
  };
  return loop.run(session, prompt, runOptions);
}

function buildApprovalHandler(
  rl: ReturnType<typeof createInterface> | null
): (toolName: string, inputSummary: string) => Promise<{ approved: boolean; reason?: string }> {
  const iface = rl ?? createInterface({ input, output });
  return (toolName: string, _inputSummary: string) =>
    new Promise((resolve) => {
      iface.question(`[approval] Approve tool "${toolName}"? (y/n or n <reason>): `, (answer) => {
        const trimmed = answer.trim();
        const lower = trimmed.toLowerCase();
        const approved = lower === "y" || lower === "yes";
        let reason: string | undefined;
        if (!approved && (lower.startsWith("n") || lower === "no")) {
          const afterN = trimmed.slice(1).trim();
          if (afterN) reason = afterN;
        }
        resolve(approved ? { approved: true } : { approved: false, ...(reason != null && { reason }) });
      });
    });
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("mini-agent")
    .description("Code agent CLI: read, write, execute with approval flow")
    .version(pkg.version, "-V, --version", "show version")
    .option("-p, --prompt <text>", "single user prompt (omit for REPL)")
    .option("--config <path>", "path to config file (default: look for mini-agent.config.json or .mini-agent.json in cwd)")
    .option("--provider <name>", "LLM provider: minimax | openai | deepseek | mock", "minimax")
    .option("--model <name>", "model name (overrides config/env)")
    .option("--stream", "stream model output token-by-token")
    .option("-t, --transcript-dir <path>", "transcript output directory")
    .option("--approval <mode>", "tool approval: never | auto | prompt", "auto")
    .option("--verbose", "print per-turn request/response summary and tool in/out lengths")
    .option("--dry-run", "only print prompt and tool list, do not call LLM or tools")
    .option("--skill <paths...>", "path(s) to SKILL.md or skill dir (e.g. --skill path1 path2)")
    .option("--plugin-dir <paths...>", "path(s) to plugin directory (Claude Code style, e.g. --plugin-dir ./p1 ./p2)")
    .option("--mcp <names...>", "MCP server name(s) to enable (default: all configured)")
    .option("--no-auto-memory", "disable Auto Memory (MEMORY.md injection)")
    .option("--claude-md-exclude <paths...>", "path(s) or prefix(es) to exclude from CLAUDE.md loading")
    .option("--memory-path <path>", "override Auto Memory root directory (default: ~/.claude)")
    .addHelpText(
      "after",
      "\nExample:\n  mini-agent --provider mock --prompt \"hello\"\n  mini-agent --provider deepseek --approval prompt --prompt \"write a ts file\"\n"
    );

  program.parse(process.argv);
  const opts = program.opts<{
    prompt?: string;
    config?: string;
    provider: string;
    model?: string;
    stream: boolean;
    transcriptDir?: string;
    approval: string;
    verbose: boolean;
    dryRun: boolean;
    skill?: string[];
    pluginDir?: string[];
    mcp?: string[];
    autoMemory?: boolean;
    claudeMdExclude?: string[];
    memoryPath?: string;
  }>();

  const cliMcpNames = Array.isArray(opts.mcp) ? opts.mcp : typeof opts.mcp === "string" ? [opts.mcp] : [];
  let resolved: ResolvedConfig;
  try {
    const approvalMode =
      opts.approval === "never" || opts.approval === "auto" || opts.approval === "prompt"
        ? opts.approval
        : "auto";
    const cliOverrides: Parameters<typeof loadConfig>[0]["cli"] = {
      provider: opts.provider,
      approval: approvalMode,
      verbose: opts.verbose ?? false,
      dryRun: opts.dryRun ?? false,
    };
    if (opts.model != null) cliOverrides.model = opts.model;
    if (opts.transcriptDir != null) cliOverrides.transcriptDir = opts.transcriptDir;
    const cliSkillPaths = Array.isArray(opts.skill) ? opts.skill : typeof opts.skill === "string" ? [opts.skill] : [];
    if (cliSkillPaths.length > 0) cliOverrides.skillPaths = cliSkillPaths;
    const cliPluginDirs = Array.isArray(opts.pluginDir) ? opts.pluginDir : typeof opts.pluginDir === "string" ? [opts.pluginDir] : [];
    if (cliPluginDirs.length > 0) cliOverrides.pluginDirs = cliPluginDirs;
    if (cliMcpNames.length > 0) cliOverrides.enabledMcpServerNames = cliMcpNames;
    if (opts.autoMemory === false) cliOverrides.autoMemoryEnabled = false;
    const cliClaudeMdExclude = Array.isArray(opts.claudeMdExclude)
      ? opts.claudeMdExclude
      : typeof opts.claudeMdExclude === "string"
        ? [opts.claudeMdExclude]
        : [];
    if (cliClaudeMdExclude.length > 0) cliOverrides.claudeMdExcludes = cliClaudeMdExclude;
    if (opts.memoryPath != null) cliOverrides.memoryPath = opts.memoryPath;
    const cliPackageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
    resolved = await loadConfig({
      ...(opts.config != null && { configPath: opts.config }),
      cwd: process.cwd(),
      defaultTranscriptDir: join(cliPackageRoot, "transcripts"),
      cli: cliOverrides,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`mini-agent config error: ${redactForLog(message)}\n`);
    process.exitCode = EXIT_CONFIG;
    return;
  }

  let skillsLoaded: { path: string; charCount: number }[] | undefined;
  let pluginsLoaded: { path: string; name: string }[] = [];
  const globalEntries =
    !resolved.skipGlobalSkills && resolved.globalSkillDirs != null && resolved.globalSkillDirs.length > 0
      ? await loadAllGlobalSkills(resolved.globalSkillDirs)
      : [];
  const projectEntries =
    resolved.skillPaths != null && resolved.skillPaths.length > 0
      ? await loadSkills(resolved.skillPaths, process.cwd())
      : [];
  let pluginEntries: Awaited<ReturnType<typeof discoverPlugins>>["skillEntries"] = [];
  if (resolved.pluginDirs != null && resolved.pluginDirs.length > 0) {
    const discovered = await discoverPlugins(resolved.pluginDirs, process.cwd());
    pluginEntries = discovered.skillEntries;
    pluginsLoaded = discovered.pluginsLoaded;
  }
  const allEntries = [...globalEntries, ...projectEntries, ...pluginEntries];
  let baseSystemPrompt = allEntries.length > 0 ? buildSystemPrompt(allEntries, SYSTEM_PROMPT) : SYSTEM_PROMPT;
  if (allEntries.length > 0) {
    skillsLoaded = allEntries.map((e) => ({ path: e.path, charCount: e.charCount }));
  }

  let claudeMdLoaded: { path: string; source: "project" | "user" | "local"; lineCount?: number }[] | undefined;
  const claudePaths = findClaudeMdPaths(process.cwd());
  if (claudePaths.length > 0) {
    const claudeEntries = await loadClaudeMdContent(
      claudePaths,
      resolved.claudeMdExcludes ?? [],
      process.cwd()
    );
    if (claudeEntries.length > 0) {
      const claudeMerged = mergeAndTag(claudeEntries);
      baseSystemPrompt = baseSystemPrompt + "\n\n" + claudeMerged.text;
      claudeMdLoaded = claudeMerged.entries.map((e) => ({
        path: e.path,
        source: e.source,
        ...(e.lineCount != null && { lineCount: e.lineCount }),
      }));
    }
  }
  resolved = { ...resolved, systemPrompt: baseSystemPrompt };

  const pluginMcp = await getPluginMcpServers(pluginsLoaded);
  if (Object.keys(pluginMcp).length > 0) {
    resolved = {
      ...resolved,
      mcpServers: { ...(resolved.mcpServers ?? {}), ...pluginMcp },
    };
  }
  if (resolved.mcpServers != null && Object.keys(resolved.mcpServers).length > 0 && cliMcpNames.length === 0) {
    resolved = { ...resolved, enabledMcpServerNames: Object.keys(resolved.mcpServers) };
  }

  const registry = new ToolRegistry();
  const workspaceCwd = process.cwd();
  registry.register(createReadFileTool(workspaceCwd));
  registry.register(createGlobSearchTool(workspaceCwd));
  registry.register(createWriteFileTool(workspaceCwd));
  registry.register(
    createExecuteCommandTool({
      cwd: workspaceCwd,
      ...(resolved.allowedCommands != null && { allowedCommands: resolved.allowedCommands }),
      timeoutMs: 60_000,
    })
  );
  const memoryWriteOpts: { cwd: string; memoryPath?: string } = { cwd: workspaceCwd };
  if (resolved.memoryPath != null && resolved.memoryPath !== "") memoryWriteOpts.memoryPath = resolved.memoryPath;
  registry.register(createMemoryWriteTool(memoryWriteOpts));

  const toolTimeoutMs = resolved.policy.toolTimeoutMs ?? 60_000;
  let mcpServersLoaded: { name: string; tools: string[] }[] = [];
  const enabledMcp = resolved.enabledMcpServerNames ?? [];
  const mcpServersConfig = resolved.mcpServers ?? {};
  if (enabledMcp.length > 0 && Object.keys(mcpServersConfig).length > 0) {
    for (const serverName of enabledMcp) {
      const config = mcpServersConfig[serverName];
      if (config == null) continue;
      try {
        const conn = await connectAndListTools(serverName, config, toolTimeoutMs);
        const adapters = createToolAdapters(serverName, conn, toolTimeoutMs);
        for (const t of adapters) registry.register(t);
        mcpServersLoaded.push({
          name: serverName,
          tools: adapters.map((t) => t.name),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[mcp] failed to connect "${serverName}": ${redactForLog(msg)}\n`);
      }
    }
  }

  const projectId = getProjectId(workspaceCwd);
  const autoMemoryEnabled = resolved.autoMemoryEnabled !== false;
  let autoMemoryLoaded: { enabled: boolean; lineCount: number; path?: string } | undefined;
  if (autoMemoryEnabled) {
    const first = await getAutoMemoryFragment(projectId, 200, resolved.memoryPath);
    autoMemoryLoaded = { enabled: true, lineCount: first.lineCount, path: first.path };
  } else {
    autoMemoryLoaded = { enabled: false, lineCount: 0 };
  }
  const getMemoryFragment = async (): Promise<string> => {
    if (!autoMemoryEnabled) return "";
    const { fragment } = await getAutoMemoryFragment(projectId, 200, resolved.memoryPath);
    return fragment;
  };

  const initialPrompt = await loadPrompt(opts.prompt);

  if (resolved.dryRun) {
    process.stderr.write(`[dry-run] prompt: ${initialPrompt ?? "(none)"}\n`);
    process.stderr.write(`[dry-run] tools: ${registry.list().map((t) => t.name).join(", ") || "none"}\n`);
    if (skillsLoaded?.length) {
      process.stderr.write(`[dry-run] skills: ${skillsLoaded.map((s) => `${s.path} (${s.charCount} chars)`).join(", ")}\n`);
    }
    if (claudeMdLoaded?.length) {
      process.stderr.write(`[dry-run] claude-md: ${claudeMdLoaded.map((c) => `${c.path} (${c.source})`).join(", ")}\n`);
    }
    process.stderr.write(`[dry-run] auto-memory: ${autoMemoryLoaded?.enabled ? `enabled, ${autoMemoryLoaded.lineCount} lines` : "disabled"}\n`);
    if (pluginsLoaded.length > 0) {
      process.stderr.write(`[dry-run] plugins: ${pluginsLoaded.map((p) => `${p.path} (${p.name})`).join(", ")}\n`);
    }
    if (enabledMcp.length > 0 && Object.keys(mcpServersConfig).length > 0) {
      process.stderr.write(`[dry-run] mcp servers (configured): ${enabledMcp.join(", ")}\n`);
    }
    return;
  }

  if (resolved.verbose && mcpServersLoaded.length > 0) {
    process.stderr.write(
      `[verbose] mcp servers: ${mcpServersLoaded.map((m) => `${m.name} (${m.tools.join(", ")})`).join("; ")}\n`
    );
  }
  if (resolved.verbose && skillsLoaded?.length) {
    process.stderr.write(`[verbose] skills loaded: ${skillsLoaded.map((s) => `${s.path} (${s.charCount} chars)`).join(", ")}\n`);
  }
  if (resolved.verbose && claudeMdLoaded?.length) {
    process.stderr.write(`[verbose] claude-md loaded: ${claudeMdLoaded.map((c) => `${c.path} (${c.source}, ${c.lineCount ?? 0} lines)`).join("; ")}\n`);
  }
  if (resolved.verbose) {
    process.stderr.write(`[verbose] auto-memory: ${autoMemoryLoaded?.enabled ? `enabled, ${autoMemoryLoaded.lineCount} lines` : "disabled"}\n`);
  }
  if (resolved.verbose && pluginsLoaded.length > 0) {
    process.stderr.write(`[verbose] plugins loaded: ${pluginsLoaded.map((p) => `${p.path} (${p.name})`).join(", ")}\n`);
  }

  let provider: ChatProvider;
  try {
    const providerId = parseProviderId(resolved.provider);
    provider = createProvider(providerId, resolved, registry.list());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`mini-agent provider error: ${redactForLog(message)}\n`);
    process.stderr.write("Check the provider name, config file, and required env vars (e.g. OPENAI_API_KEY, DEEPSEEK_API_KEY, MINIMAX_API_KEY).\n");
    process.exitCode = EXIT_CONFIG;
    return;
  }

  const effectiveApproval =
    resolved.approval === "prompt" && !input.isTTY ? "never" : resolved.approval;
  if (resolved.approval === "prompt" && !input.isTTY) {
    process.stderr.write("mini-agent: --approval prompt requires TTY; falling back to never.\n");
  }

  const session = new AgentSession();
  const loop = new AgentLoop(provider, resolved.policy, registry);
  const sessionId = createSessionId();
  setSessionId(sessionId);

  if (initialPrompt != null) {
    const approvalRl =
      effectiveApproval === "prompt" && input.isTTY ? createInterface({ input, output }) : null;
    const runOpts: RunOneTurnOpts = {
      stream: opts.stream ?? false,
      verbose: resolved.verbose,
      approvalMode: effectiveApproval,
      ...(effectiveApproval === "prompt" && input.isTTY && {
        onApprovalRequest: buildApprovalHandler(approvalRl),
      }),
      getMemoryFragment,
    };
    try {
      const result = await runOneTurn(loop, session, initialPrompt, runOpts, provider);
      if (!opts.stream && result.finalText) {
        output.write(`${result.finalText}\n`);
      }
      if (opts.stream) output.write("\n");
      const transcriptPath = await writeTranscript(resolved.transcriptDir, {
        sessionId,
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
        ...(result.approvalLog.length > 0 && { approvalLog: result.approvalLog }),
        ...(skillsLoaded != null && skillsLoaded.length > 0 && { skillsLoaded }),
        ...(pluginsLoaded.length > 0 && { pluginsLoaded }),
        ...(mcpServersLoaded.length > 0 && { mcpServersLoaded }),
        ...(claudeMdLoaded != null && claudeMdLoaded.length > 0 && { claudeMdLoaded }),
        ...(autoMemoryLoaded != null && { autoMemoryLoaded }),
      });
      output.write(
        `sessionId=${sessionId} turns=${result.turns}, toolCalls=${result.toolCalls}, elapsed=${result.elapsedTotalMs}ms\ntranscript=${transcriptPath}\n`
      );
    } catch (err) {
      if (err instanceof LoopSpinDetectedError || err instanceof LoopLimitError) {
        const meta = {
          ...(err instanceof LoopSpinDetectedError && { spinDetected: true }),
          error: { name: err.name, message: err.message },
        };
        const transcriptPath = await writeTranscript(resolved.transcriptDir, {
          sessionId,
          createdAt: new Date().toISOString(),
          provider: provider.name,
          policy: resolved.policy,
          messages: session.getMessages(),
          meta,
          ...(skillsLoaded != null && skillsLoaded.length > 0 && { skillsLoaded }),
          ...(pluginsLoaded.length > 0 && { pluginsLoaded }),
          ...(mcpServersLoaded.length > 0 && { mcpServersLoaded }),
          ...(claudeMdLoaded != null && claudeMdLoaded.length > 0 && { claudeMdLoaded }),
          ...(autoMemoryLoaded != null && { autoMemoryLoaded }),
        });
        await appendErrorLog(resolved.transcriptDir, {
          sessionId,
          timestamp: new Date().toISOString(),
          name: err.name,
          message: err.message,
          transcriptPath,
        });
        process.stderr.write(
          `error: ${err.message}\nsessionId=${sessionId} transcript=${transcriptPath}\n`
        );
      } else {
        throw err;
      }
      process.exitCode = EXIT_BUSINESS;
    } finally {
      clearSessionId();
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

  const replRunOpts: RunOneTurnOpts = {
    stream: opts.stream ?? false,
    verbose: resolved.verbose,
    approvalMode: effectiveApproval,
    ...(effectiveApproval === "prompt" && input.isTTY && { onApprovalRequest: buildApprovalHandler(rl) }),
    getMemoryFragment,
  };

  for (;;) {
    const line = await new Promise<string>((resolve) => {
      rl.question("> ", resolve);
    });
    const prompt = line.trim();
    if (prompt.length === 0) break;
    try {
      const result = await runOneTurn(loop, session, prompt, replRunOpts, provider);
      if (!opts.stream && result.finalText) {
        output.write(`${result.finalText}\n`);
      }
      if (opts.stream) output.write("\n");
      output.write(
        `[sessionId=${sessionId} turns=${result.turns}, toolCalls=${result.toolCalls}, elapsed=${result.elapsedTotalMs}ms]\n`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`error: ${msg}\n`);
      if (err instanceof LoopSpinDetectedError || err instanceof LoopLimitError) {
        const meta = {
          ...(err instanceof LoopSpinDetectedError && { spinDetected: true }),
          error: err instanceof Error ? { name: err.name, message: err.message } : { name: "Error", message: String(err) },
        };
        const transcriptPath = await writeTranscript(resolved.transcriptDir, {
          sessionId,
          createdAt: new Date().toISOString(),
          provider: provider.name,
          policy: resolved.policy,
          messages: session.getMessages(),
          meta,
          ...(skillsLoaded != null && skillsLoaded.length > 0 && { skillsLoaded }),
          ...(pluginsLoaded.length > 0 && { pluginsLoaded }),
          ...(mcpServersLoaded.length > 0 && { mcpServersLoaded }),
          ...(claudeMdLoaded != null && claudeMdLoaded.length > 0 && { claudeMdLoaded }),
          ...(autoMemoryLoaded != null && { autoMemoryLoaded }),
        });
        await appendErrorLog(resolved.transcriptDir, {
          sessionId,
          timestamp: new Date().toISOString(),
          name: err instanceof Error ? err.name : "Error",
          message: err instanceof Error ? err.message : String(err),
          transcriptPath,
        });
        process.stderr.write(`sessionId=${sessionId} transcript=${transcriptPath}\n`);
      }
      process.exitCode = EXIT_BUSINESS;
    }
  }

  const transcriptPath = await writeTranscript(resolved.transcriptDir, {
    sessionId,
    createdAt: new Date().toISOString(),
    provider: provider.name,
    policy: resolved.policy,
    messages: session.getMessages(),
    ...(skillsLoaded != null && skillsLoaded.length > 0 && { skillsLoaded }),
    ...(pluginsLoaded.length > 0 && { pluginsLoaded }),
    ...(mcpServersLoaded.length > 0 && { mcpServersLoaded }),
    ...(claudeMdLoaded != null && claudeMdLoaded.length > 0 && { claudeMdLoaded }),
    ...(autoMemoryLoaded != null && { autoMemoryLoaded }),
  });
  output.write(`sessionId=${sessionId} transcript=${transcriptPath}\n`);
  clearSessionId();
  rl.close();
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown error during startup.";
  process.stderr.write(`mini-agent failed: ${redactForLog(message)}\n`);
  process.exitCode = EXIT_BUSINESS;
});
