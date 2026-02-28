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
}
