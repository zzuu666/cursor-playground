import type { AgentMode, ApprovalMode } from "../config.js";
import { AGENT_MODE } from "../config.js";
import { LoopLimitError, LoopSpinDetectedError } from "../infra/errors.js";
import { PLAN_MODE_SYSTEM_SUFFIX } from "../prompts/system.js";
import type { ApprovalLogEntry } from "../infra/logger.js";
import { logStreamTurn, logToolCall, logTurnDiagnostics } from "../infra/logger.js";
import type { ChatProvider } from "../providers/base.js";
import type { ToolRegistry } from "../tools/registry.js";
import { DEFAULT_LOOP_POLICY, type LoopPolicy } from "./policy.js";
import type {
  AssistantContentBlock,
  ConversationMessage,
  ToolUseBlock,
} from "./session.js";
import { AgentSession, ruleSummary } from "./session.js";
import { estimateTokens } from "./token-estimate.js";

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

/** Phase 13: 将 messages 序列化为给 LLM 摘要用的文本，并截断到 maxChars。 */
function serializeForSummary(messages: ConversationMessage[], maxChars: number): string {
  const parts: string[] = [];3
  let len = 0;
  for (const msg of messages) {
    let s: string;
    if (msg.role === "user") {
      s = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    } else {
      s = msg.content.map((b) => (b.type === "text" ? b.text : b.type === "thinking" ? b.thinking : JSON.stringify(b))).join("\n");
    }
    const line = `[${msg.role}]: ${s.slice(0, 2000)}${s.length > 2000 ? "..." : ""}\n`;
    if (len + line.length > maxChars) {
      parts.push(line.slice(0, maxChars - len));
      break;
    }
    parts.push(line);
    len += line.length;
  }
  return parts.join("");
}

export interface TurnDiagnostic {
  turn: number;
  toolCount: number;
  elapsedMs: number;
  /** Phase 13: 当轮发给 LLM 的 messages 估算 token 数。 */
  estimatedTokens?: number;
}

/** Phase 13: 单次上下文压缩事件。 */
export interface ContextCompressEvent {
  atTurn: number;
  estimatedTokens: number;
  strategy: "rule" | "llm";
  memoryWritten: boolean;
}

export interface LoopResult {
  finalText: string;
  turns: number;
  toolCalls: number;
  diagnostics: TurnDiagnostic[];
  elapsedTotalMs: number;
  /** 本次 run 内发生的工具批准/拒绝记录。 */
  approvalLog: ApprovalLogEntry[];
  /** Phase 13: 本次 run 内触发的上下文压缩事件。 */
  contextCompressEvents?: ContextCompressEvent[];
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
  /** 每轮调用 LLM 前获取 Auto Memory 片段，非空时 prepend 为一条 user 消息。 */
  getMemoryFragment?: () => Promise<string>;
  /** Phase 13: 压缩前将规则摘要写入 Memory 时调用。 */
  onBeforeCompress?: (
    removed: ConversationMessage[],
    ruleSummaryText: string
  ) => Promise<void>;
  /** 运行模式：agent 全工具，plan 仅只读工具。 */
  mode?: AgentMode;
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
    const getMemoryFragment = options.getMemoryFragment;
    const onBeforeCompress = options.onBeforeCompress;
    const contextCompressEvents: ContextCompressEvent[] = [];
    const mode: AgentMode = options.mode ?? AGENT_MODE.Agent;
    const effectiveTools =
      mode === AGENT_MODE.Plan && this.registry
        ? this.registry.listReadOnly()
        : this.registry
          ? this.registry.list()
          : [];

    while (turns < this.policy.maxTurns) {
      turns += 1;
      const startTime = Date.now();

      let baseMessages = session.getMessages();
      const memoryFragment = await (getMemoryFragment?.() ?? Promise.resolve(""));
      let messages =
        memoryFragment.trim().length > 0
          ? [{ role: "user" as const, content: memoryFragment }, ...baseMessages]
          : baseMessages;

      const estimatedTokens = estimateTokens(messages);
      const tokenTrigger =
        this.policy.compressStrategy === "token_based" &&
        this.policy.contextMaxTokens > 0 &&
        estimatedTokens > this.policy.contextMaxTokens;
      const countTrigger =
        this.policy.compressStrategy === "message_count" &&
        baseMessages.length > this.policy.summaryThreshold;
      const shouldCompress = tokenTrigger || countTrigger;

      if (shouldCompress) {
        const toRemove = baseMessages.length - this.policy.summaryKeepRecent;
        if (toRemove > 0) {
          const removed = baseMessages.slice(0, toRemove);
          const ruleSummaryText = ruleSummary(removed);
          if (onBeforeCompress) {
            await onBeforeCompress(removed, ruleSummaryText);
          }
          const getSummary = this.policy.useLlmSummary
            ? (removedMsgs: ConversationMessage[]): Promise<string> => {
                const prompt =
                  "Summarize the following conversation in one short paragraph, preserving user intent and key conclusions:\n\n" +
                  serializeForSummary(
                    removedMsgs,
                    this.policy.llmSummaryMaxInputChars
                  );
                return new Promise((resolve, reject) => {
                  const t = setTimeout(() => {
                    reject(new Error("LLM summary timeout"));
                  }, this.policy.llmSummaryTimeoutMs);
                  this.provider
                    .complete([{ role: "user", content: prompt }])
                    .then((blks) => {
                      clearTimeout(t);
                      resolve(getTextFromBlocks(blks).trim() || ruleSummary(removedMsgs));
                    })
                    .catch((err) => {
                      clearTimeout(t);
                      reject(err);
                    });
                });
              }
            : undefined;
          await session.compressToSummary(
            this.policy.summaryThreshold,
            this.policy.summaryKeepRecent,
            getSummary != null ? { getSummary } : undefined
          );
          contextCompressEvents.push({
            atTurn: turns,
            estimatedTokens,
            strategy: this.policy.useLlmSummary ? "llm" : "rule",
            memoryWritten: onBeforeCompress != null,
          });
          if (verbose) {
            process.stderr.write(
              `[verbose] context compressed at turn ${turns}, strategy=${this.policy.useLlmSummary ? "llm" : "rule"}, memoryWritten=${onBeforeCompress != null}\n`
            );
          }
        }
      } else if (this.policy.compressStrategy === "message_count") {
        await session.compressToSummary(
          this.policy.summaryThreshold,
          this.policy.summaryKeepRecent
        );
      }
      baseMessages = session.getMessages();
      messages =
        memoryFragment.trim().length > 0
          ? [{ role: "user" as const, content: memoryFragment }, ...baseMessages]
          : baseMessages;

      if (verbose) {
        process.stderr.write(`[verbose] turn ${turns} request: ${messages.length} messages, estimated tokens: ${estimatedTokens}\n`);
      }
      if (useStream) logStreamTurn(turns, "start");
      const completeOptions = {
        tools: effectiveTools,
        ...(mode === AGENT_MODE.Plan && { systemPromptSuffix: PLAN_MODE_SYSTEM_SUFFIX }),
      };
      const blocks = useStream
        ? await this.provider.streamComplete!(messages, streamCallbacks, completeOptions)
        : await this.provider.complete(messages, completeOptions);
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
        diagnostics.push({
          turn: turns,
          toolCount: toolCalls,
          elapsedMs,
          estimatedTokens,
        });
        logTurnDiagnostics(turns, toolCalls, elapsedMs);
        return {
          finalText: getTextFromBlocks(blocks),
          turns,
          toolCalls,
          diagnostics,
          elapsedTotalMs: Date.now() - runStartTime,
          approvalLog,
          ...(contextCompressEvents.length > 0 && { contextCompressEvents }),
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
      diagnostics.push({
        turn: turns,
        toolCount: toolCalls,
        elapsedMs,
        estimatedTokens,
      });
      logTurnDiagnostics(turns, toolCalls, elapsedMs);
    }

    throw new LoopLimitError(`maxTurns exceeded: ${this.policy.maxTurns}`);
  }
}
