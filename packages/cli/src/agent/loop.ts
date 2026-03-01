import { LoopLimitError } from "../infra/errors.js";
import type { ChatProvider } from "../providers/base.js";
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
    private readonly policy: LoopPolicy = DEFAULT_LOOP_POLICY
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
      const blocks = useStream
        ? await this.provider.streamComplete!(session.getMessages(), streamCallbacks)
        : await this.provider.complete(session.getMessages());
      session.addAssistantBlocks(blocks);

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

        session.addToolResult(
          toolUse.id,
          "Phase 0 does not execute tools yet. Implement tool registry in Phase 2.",
          true
        );
      }
    }

    throw new LoopLimitError(`maxTurns exceeded: ${this.policy.maxTurns}`);
  }
}
