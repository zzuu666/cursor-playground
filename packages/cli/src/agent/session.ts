export interface TextBlock {
  type: "text";
  text: string;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type AssistantContentBlock = TextBlock | ThinkingBlock | ToolUseBlock;
export type UserContentBlock = TextBlock | ToolResultBlock;

export type ConversationMessage =
  | {
      role: "user";
      content: string | UserContentBlock[];
    }
  | {
      role: "assistant";
      content: AssistantContentBlock[];
    };

export class AgentSession {
  private readonly messages: ConversationMessage[] = [];

  addUserText(input: string): void {
    this.messages.push({
      role: "user",
      content: input,
    });
  }

  addAssistantBlocks(blocks: AssistantContentBlock[]): void {
    this.messages.push({
      role: "assistant",
      content: blocks,
    });
  }

  addToolResult(toolUseId: string, content: string, isError = false): void {
    const block: ToolResultBlock = {
      type: "tool_result",
      tool_use_id: toolUseId,
      content,
    };
    if (isError) {
      block.is_error = true;
    }

    this.messages.push({
      role: "user",
      content: [block],
    });
  }

  getMessages(): ConversationMessage[] {
    return this.messages;
  }

  /**
   * When messages exceed threshold, replace early messages with a single
   * rule-based summary. Keeps the most recent keepRecent messages.
   */
  compressToSummary(threshold: number, keepRecent: number): void {
    if (this.messages.length <= threshold) return;

    const toRemove = this.messages.length - keepRecent;
    if (toRemove <= 0) return;

    const removed = this.messages.splice(0, toRemove);
    let userTurns = 0;
    let toolCalls = 0;
    let firstUserIntent = "";

    for (const msg of removed) {
      if (msg.role === "user") {
        if (typeof msg.content === "string") {
          userTurns += 1;
          if (!firstUserIntent && msg.content.trim()) {
            firstUserIntent = msg.content.trim().slice(0, 200);
            if (msg.content.length > 200) firstUserIntent += "...";
          }
        } else {
          const hasToolResult = msg.content.some((b) => b.type === "tool_result");
          if (hasToolResult) toolCalls += 1;
        }
      }
    }

    const summary =
      firstUserIntent
        ? `[Earlier conversation: ${userTurns} user turn(s), ${toolCalls} tool result(s). First user input: "${firstUserIntent}"]`
        : `[Earlier conversation: ${userTurns} user turn(s), ${toolCalls} tool result(s).]`;

    this.messages.unshift({
      role: "user",
      content: summary,
    });
  }
}
