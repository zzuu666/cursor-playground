import { LoopLimitError, LoopSpinDetectedError } from "../infra/errors.js";
import { logStreamTurn, logToolCall, logTurnDiagnostics } from "../infra/logger.js";
import type { ChatProvider } from "../providers/base.js";
import type { ToolRegistry } from "../tools/registry.js";
import { DEFAULT_LOOP_POLICY, type LoopPolicy } from "./policy.js";
import type { AssistantContentBlock, ToolUseBlock } from "./session.js";
import { AgentSession } from "./session.js";

function getTextFromBlocks(blocks: AssistantContentBlock[]): string {
  return blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function toolCallFingerprint(name: string, input: Record<string, unknown>): string {
  const keys = Object.keys(input).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of keys) sorted[k] = input[k];
  return `${name}|${JSON.stringify(sorted)}`;
}

export interface TurnDiagnostic {
  turn: number;
  toolCount: number;
  elapsedMs: number;
}

export interface LoopResult {
  finalText: string;
  turns: number;
  toolCalls: number;
  diagnostics: TurnDiagnostic[];
  elapsedTotalMs: number;
}

export interface RunOptions {
  onStreamText?: (delta: string) => void;
  /** When true, log per-turn request/response summary and tool in/out lengths. */
  verbose?: boolean;
}

export class AgentLoop {
  constructor(
    private readonly provider: ChatProvider,
    private readonly policy: LoopPolicy = DEFAULT_LOOP_POLICY,
    private readonly registry?: ToolRegistry
  ) {}

  async run(
    session: AgentSession,
    userInput: string,
    options: RunOptions = {}
  ): Promise<LoopResult> {
    session.addUserText(userInput);

    let turns = 0;
    let toolCalls = 0;
    const recentFingerprints: string[] = [];
    const diagnostics: TurnDiagnostic[] = [];
    const runStartTime = Date.now();
    const maxFingerprintHistory = Math.max(20, this.policy.maxSameToolRepeat * 4);

    const useStream =
      options.onStreamText != null && this.provider.streamComplete != null;
    const streamCallbacks =
      options.onStreamText != null
        ? { onText: options.onStreamText }
        : {};
    const verbose = options.verbose === true;

    while (turns < this.policy.maxTurns) {
      turns += 1;
      session.compressToSummary(
        this.policy.summaryThreshold,
        this.policy.summaryKeepRecent
      );
      const startTime = Date.now();

      if (verbose) {
        const msgCount = session.getMessages().length;
        process.stderr.write(`[verbose] turn ${turns} request: ${msgCount} messages\n`);
      }
      if (useStream) logStreamTurn(turns, "start");
      const blocks = useStream
        ? await this.provider.streamComplete!(session.getMessages(), streamCallbacks)
        : await this.provider.complete(session.getMessages());
      session.addAssistantBlocks(blocks);
      if (useStream) logStreamTurn(turns, "end");
      if (verbose) {
        const textLen = getTextFromBlocks(blocks).length;
        process.stderr.write(`[verbose] turn ${turns} response: ${blocks.length} blocks, text ${textLen} chars\n`);
      }

      const toolUseBlocks = blocks.filter(
        (block): block is ToolUseBlock => block.type === "tool_use"
      );
      if (toolUseBlocks.length === 0) {
        const elapsedMs = Date.now() - startTime;
        diagnostics.push({ turn: turns, toolCount: toolCalls, elapsedMs });
        logTurnDiagnostics(turns, toolCalls, elapsedMs);
        return {
          finalText: getTextFromBlocks(blocks),
          turns,
          toolCalls,
          diagnostics,
          elapsedTotalMs: Date.now() - runStartTime,
        };
      }

      for (const toolUse of toolUseBlocks) {
        toolCalls += 1;
        if (toolCalls > this.policy.maxToolCalls) {
          throw new LoopLimitError(
            `maxToolCalls exceeded: ${this.policy.maxToolCalls}`
          );
        }

        const input = toolUse.input as Record<string, unknown>;
        const fingerprint = toolCallFingerprint(toolUse.name, input);
        const sameCount =
          recentFingerprints.filter((f) => f === fingerprint).length;
        if (sameCount >= this.policy.maxSameToolRepeat - 1) {
          throw new LoopSpinDetectedError(
            `Same tool call repeated ${this.policy.maxSameToolRepeat} times: ${toolUse.name}`,
            toolUse.name,
            this.policy.maxSameToolRepeat
          );
        }

        const tool = this.registry?.get(toolUse.name);
        if (tool) {
          try {
            const content = await tool.execute(input);
            session.addToolResult(toolUse.id, content, false);
            const resultBytes = Buffer.byteLength(content, "utf-8");
            logToolCall(toolUse.name, input, {
              ok: true,
              bytes: resultBytes,
            });
            if (verbose) {
              const inputBytes = Buffer.byteLength(JSON.stringify(input), "utf-8");
              process.stderr.write(`[verbose] tool ${toolUse.name} inputLen=${inputBytes} resultLen=${resultBytes}\n`);
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            session.addToolResult(toolUse.id, `Tool error: ${message}`, true);
            logToolCall(toolUse.name, input, { ok: false, error: message });
            if (verbose) {
              const inputBytes = Buffer.byteLength(JSON.stringify(input), "utf-8");
              process.stderr.write(`[verbose] tool ${toolUse.name} inputLen=${inputBytes} error\n`);
            }
          }
        } else {
          const errorMsg = `Unknown tool: ${toolUse.name}. Available: ${this.registry ? this.registry.list().map((t) => t.name).join(", ") : "none"}`;
          session.addToolResult(toolUse.id, errorMsg, true);
          logToolCall(toolUse.name, input, { ok: false, error: errorMsg });
          if (verbose) {
            const inputBytes = Buffer.byteLength(JSON.stringify(input), "utf-8");
            process.stderr.write(`[verbose] tool ${toolUse.name} inputLen=${inputBytes} error\n`);
          }
        }
        recentFingerprints.push(fingerprint);
        if (recentFingerprints.length > maxFingerprintHistory) {
          recentFingerprints.shift();
        }
      }

      const elapsedMs = Date.now() - startTime;
      diagnostics.push({ turn: turns, toolCount: toolCalls, elapsedMs });
      logTurnDiagnostics(turns, toolCalls, elapsedMs);
    }

    throw new LoopLimitError(`maxTurns exceeded: ${this.policy.maxTurns}`);
  }
}
