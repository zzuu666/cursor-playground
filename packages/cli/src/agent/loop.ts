import { LoopLimitError } from "../infra/errors.js";
import { logStreamTurn, logToolCall } from "../infra/logger.js";
import type { ChatProvider } from "../providers/base.js";
import type { ToolRegistry } from "../tools/registry.js";
import { DEFAULT_LOOP_POLICY, type LoopPolicy } from "./policy.js";
import type { AssistantContentBlock } from "./session.js";
import { AgentSession } from "./session.js";

function getTextFromBlocks(blocks: AssistantContentBlock[]): string {
  return blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export interface LoopResult {
  finalText: string;
  turns: number;
  toolCalls: number;
}

export interface RunOptions {
  onStreamText?: (delta: string) => void;
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

    const useStream =
      options.onStreamText != null && this.provider.streamComplete != null;
    const streamCallbacks =
      options.onStreamText != null
        ? { onText: options.onStreamText }
        : {};

    while (turns < this.policy.maxTurns) {
      turns += 1;
      if (useStream) logStreamTurn(turns, "start");
      const blocks = useStream
        ? await this.provider.streamComplete!(session.getMessages(), streamCallbacks)
        : await this.provider.complete(session.getMessages());
      session.addAssistantBlocks(blocks);
      if (useStream) logStreamTurn(turns, "end");

      const toolUseBlocks = blocks.filter((block) => block.type === "tool_use");
      if (toolUseBlocks.length === 0) {
        return {
          finalText: getTextFromBlocks(blocks),
          turns,
          toolCalls,
        };
      }

      for (const toolUse of toolUseBlocks) {
        toolCalls += 1;
        if (toolCalls > this.policy.maxToolCalls) {
          throw new LoopLimitError(
            `maxToolCalls exceeded: ${this.policy.maxToolCalls}`
          );
        }

        const tool = this.registry?.get(toolUse.name);
        const input = toolUse.input as Record<string, unknown>;
        if (tool) {
          try {
            const content = await tool.execute(input);
            session.addToolResult(toolUse.id, content, false);
            logToolCall(toolUse.name, input, {
              ok: true,
              bytes: Buffer.byteLength(content, "utf-8"),
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            session.addToolResult(toolUse.id, `Tool error: ${message}`, true);
            logToolCall(toolUse.name, input, { ok: false, error: message });
          }
        } else {
          const errorMsg = `Unknown tool: ${toolUse.name}. Available: ${this.registry ? this.registry.list().map((t) => t.name).join(", ") : "none"}`;
          session.addToolResult(toolUse.id, errorMsg, true);
          logToolCall(toolUse.name, input, { ok: false, error: errorMsg });
        }
      }
    }

    throw new LoopLimitError(`maxTurns exceeded: ${this.policy.maxTurns}`);
  }
}
