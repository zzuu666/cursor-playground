import type { ApprovalMode } from "../config.js";
import { LoopLimitError, LoopSpinDetectedError } from "../infra/errors.js";
import type { ApprovalLogEntry } from "../infra/logger.js";
import { logStreamTurn, logToolCall, logTurnDiagnostics } from "../infra/logger.js";
import type { ChatProvider } from "../providers/base.js";
import type { ToolRegistry } from "../tools/registry.js";
import { DEFAULT_LOOP_POLICY, type LoopPolicy } from "./policy.js";
import type { AssistantContentBlock, ToolUseBlock } from "./session.js";
import { AgentSession } from "./session.js";

const INPUT_SUMMARY_MAX = 200;

function inputSummary(input: Record<string, unknown>): string {
  const s = JSON.stringify(input);
  return s.length <= INPUT_SUMMARY_MAX ? s : s.slice(0, INPUT_SUMMARY_MAX) + "...";
}

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
  /** 本次 run 内发生的工具批准/拒绝记录。 */
  approvalLog: ApprovalLogEntry[];
}

export interface RunOptions {
  onStreamText?: (delta: string) => void;
  /** When true, log per-turn request/response summary and tool in/out lengths. */
  verbose?: boolean;
  /** 批准策略，默认 auto。 */
  approvalMode?: ApprovalMode;
  /** 仅当 approvalMode 为 prompt 且工具 requiresApproval 时调用。 */
  onApprovalRequest?: (
    toolName: string,
    inputSummary: string
  ) => Promise<{ approved: boolean; reason?: string }>;
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
    const approvalLog: ApprovalLogEntry[] = [];
    const runStartTime = Date.now();
    const maxFingerprintHistory = Math.max(20, this.policy.maxSameToolRepeat * 4);
    const approvalMode = options.approvalMode ?? "auto";
    const onApprovalRequest = options.onApprovalRequest;

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
          approvalLog,
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
        // Only treat as spin when the same (tool, input) is repeated *consecutively*
        const recent = recentFingerprints.slice(
          -(this.policy.maxSameToolRepeat - 1)
        );
        const consecutiveSame =
          recent.length >= this.policy.maxSameToolRepeat - 1 &&
          recent.every((f) => f === fingerprint);
        if (consecutiveSame) {
          throw new LoopSpinDetectedError(
            `Same tool call repeated ${this.policy.maxSameToolRepeat} times: ${toolUse.name}`,
            toolUse.name,
            this.policy.maxSameToolRepeat
          );
        }

        const tool = this.registry?.get(toolUse.name);
        const summary = inputSummary(input);

        const pushApproval = (decision: "approved" | "rejected", userReason?: string): void => {
          approvalLog.push({
            toolName: toolUse.name,
            inputSummary: summary,
            decision,
            ...(userReason != null && userReason !== "" && { userReason }),
            timestamp: new Date().toISOString(),
          });
        };

        if (tool) {
          const needsApproval = tool.requiresApproval === true;
          let shouldExecute = true;
          let rejectMessage: string | undefined;

          if (needsApproval) {
            if (approvalMode === "never") {
              shouldExecute = false;
              rejectMessage =
                "This tool requires user approval. Current policy is 'never', so the request was rejected. Please try another approach.";
              pushApproval("rejected");
            } else if (approvalMode === "prompt") {
              if (onApprovalRequest) {
                const { approved, reason } = await onApprovalRequest(toolUse.name, summary);
                if (!approved) {
                  shouldExecute = false;
                  rejectMessage =
                    reason != null && reason.trim() !== ""
                      ? `User rejected this tool call. Reason: ${reason.trim()}. Please try another approach.`
                      : "User rejected this tool call. Please try another approach.";
                  pushApproval("rejected", reason);
                } else {
                  pushApproval("approved");
                }
              } else {
                shouldExecute = false;
                rejectMessage =
                  "This tool requires user approval but no approval handler is available (e.g. not a TTY). Request rejected. Please try another approach.";
                pushApproval("rejected");
              }
            } else {
              pushApproval("approved");
            }
          }

          if (!shouldExecute && rejectMessage != null) {
            session.addToolResult(toolUse.id, rejectMessage, false);
            logToolCall(toolUse.name, input, { ok: false, error: "rejected by user or policy" });
            if (verbose) {
              process.stderr.write(`[verbose] tool ${toolUse.name} approval rejected\n`);
            }
          } else {
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
