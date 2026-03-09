/**
 * Slash command dispatcher: parses `/command [args]` input and routes to
 * built-in handlers or skill invocations.
 */
import type { AgentSession } from "../agent/session.js";
import type { SkillEntry } from "../skills/load.js";
import type { LoopPolicy } from "../agent/policy.js";
import { estimateTokens } from "../agent/token-estimate.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlashContext {
  session: AgentSession;
  policy: LoopPolicy;
  skills: SkillEntry[];
}

export type SlashResult =
  | { handled: true; message: string }
  | { handled: false; prompt: string };

// ---------------------------------------------------------------------------
// Built-in commands
// ---------------------------------------------------------------------------

interface BuiltinCommand {
  name: string;
  description: string;
  handler: (args: string, ctx: SlashContext) => Promise<SlashResult> | SlashResult;
}

function handleClear(_args: string, ctx: SlashContext): SlashResult {
  ctx.session.clear();
  return { handled: true, message: "Conversation cleared." };
}

function handleCompact(_args: string, ctx: SlashContext): SlashResult {
  const { policy, session } = ctx;
  const before = session.getMessages().length;
  // Force compress regardless of threshold by passing threshold=0
  void session.compressToSummary(0, policy.summaryKeepRecent);
  const after = session.getMessages().length;
  return {
    handled: true,
    message: `Context compacted (${before} → ${after} messages).`,
  };
}

function handleHelp(_args: string, ctx: SlashContext): SlashResult {
  const lines: string[] = ["Available slash commands:", ""];
  for (const cmd of BUILTIN_COMMANDS) {
    lines.push(`  /${cmd.name}  — ${cmd.description}`);
  }
  const invocableSkills = ctx.skills.filter((s) => s.name != null);
  if (invocableSkills.length > 0) {
    lines.push("", "Skills:");
    for (const s of invocableSkills) {
      const desc = s.description ?? "(no description)";
      lines.push(`  /${s.name}  — ${desc}`);
    }
  }
  return { handled: true, message: lines.join("\n") };
}

function handleCost(_args: string, ctx: SlashContext): SlashResult {
  const messages = ctx.session.getMessages();
  const tokens = estimateTokens(messages);
  return {
    handled: true,
    message: `Session: ${messages.length} messages, ~${tokens} tokens (estimated).`,
  };
}

function handleExit(): SlashResult {
  return { handled: true, message: "__EXIT__" };
}

const BUILTIN_COMMANDS: BuiltinCommand[] = [
  { name: "clear", description: "Clear conversation history", handler: handleClear },
  { name: "compact", description: "Compress conversation context", handler: handleCompact },
  { name: "help", description: "List available commands and skills", handler: handleHelp },
  { name: "cost", description: "Show estimated token usage", handler: handleCost },
  { name: "exit", description: "Exit the session", handler: handleExit },
];

/** Hint item for TUI autocomplete / command list when user types "/". */
export interface SlashCommandHint {
  name: string;
  description: string;
}

const MAX_SLASH_HINTS = 6;

/**
 * Return all slash command hints (builtin + skills) for showing in TUI when input starts with "/".
 */
export function getSlashCommandHints(skills: SkillEntry[]): SlashCommandHint[] {
  const builtins: SlashCommandHint[] = BUILTIN_COMMANDS.map((c) => ({
    name: c.name,
    description: c.description,
  }));
  const fromSkills: SlashCommandHint[] = skills
    .filter((s): s is SkillEntry & { name: string } => s.name != null)
    .map((s) => ({ name: s.name, description: s.description ?? "(no description)" }));
  return [...builtins, ...fromSkills];
}

/**
 * Filter hints by prefix after "/" and return at most MAX_SLASH_HINTS for dropdown.
 */
export function getFilteredSlashHints(
  skills: SkillEntry[],
  prefix: string
): SlashCommandHint[] {
  const all = getSlashCommandHints(skills);
  const afterSlash = prefix.startsWith("/") ? prefix.slice(1).toLowerCase() : "";
  if (afterSlash === "") return all.slice(0, MAX_SLASH_HINTS);
  return all
    .filter((h) => h.name.toLowerCase().startsWith(afterSlash))
    .slice(0, MAX_SLASH_HINTS);
}

// ---------------------------------------------------------------------------
// Skill argument substitution
// ---------------------------------------------------------------------------

function substituteArgs(content: string, args: string[]): string {
  let result = content;
  const joined = args.join(" ");

  result = result.replace(/\$ARGUMENTS/g, joined);

  // $ARGUMENTS[N] and $N shorthand
  result = result.replace(/\$ARGUMENTS\[(\d+)\]/g, (_m, idx) => args[Number(idx)] ?? "");
  result = result.replace(/\$(\d+)/g, (_m, idx) => args[Number(idx)] ?? "");

  return result;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Parse user input and dispatch to a builtin command or skill.
 * Returns `{ handled: true, message }` for commands that produce local output,
 * or `{ handled: false, prompt }` when the (possibly rewritten) input should
 * be sent to the LLM via `runOneTurn`.
 */
export async function dispatchSlash(
  input: string,
  ctx: SlashContext
): Promise<SlashResult> {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return { handled: false, prompt: trimmed };
  }

  const spaceIdx = trimmed.indexOf(" ");
  const cmdName = (spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx)).toLowerCase();
  const rawArgs = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

  // Try built-in commands first
  const builtin = BUILTIN_COMMANDS.find((c) => c.name === cmdName);
  if (builtin) {
    return builtin.handler(rawArgs, ctx);
  }

  // Try skill lookup by name
  const skill = ctx.skills.find(
    (s) => s.name != null && s.name.toLowerCase() === cmdName
  );
  if (skill) {
    const args = rawArgs.length > 0 ? rawArgs.split(/\s+/) : [];
    let prompt = substituteArgs(skill.content, args);
    // If skill content didn't contain $ARGUMENTS placeholders and args were given, append them
    if (rawArgs.length > 0 && prompt === skill.content) {
      prompt = `${prompt}\n\nARGUMENTS: ${rawArgs}`;
    }
    return { handled: false, prompt };
  }

  // Unknown slash command — pass through as-is to the model
  return { handled: false, prompt: trimmed };
}

/** Sentinel value returned by /exit to signal the caller to quit. */
export const EXIT_SENTINEL = "__EXIT__";
