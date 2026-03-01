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
   * 收集消息列表中所有 assistant 的 tool_use id，用于判断 tool_result 是否成对存在。
   */
  private static toolUseIdsInMessages(messages: ConversationMessage[]): Set<string> {
    const ids = new Set<string>();
    for (const msg of messages) {
      if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if (block.type === "tool_use" && "id" in block) ids.add(block.id);
      }
    }
    return ids;
  }

  /**
   * When messages exceed threshold, replace early messages with a single
   * rule-based summary. Keeps the most recent keepRecent messages.
   * 压缩后会丢弃「孤儿」tool_result：其 tool_use_id 在保留的 assistant 中已不存在，避免 API 报 2013。
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

    // 丢弃紧跟在 summary 后的、仅含「孤儿」tool_result 的 user 消息，避免 API 报 tool_use_id not found (2013)
    const allowedIds = AgentSession.toolUseIdsInMessages(this.messages);
    while (this.messages.length > 1) {
      const next = this.messages[1];
      if (next == null || next.role !== "user" || typeof next.content !== "object" || !Array.isArray(next.content)) break;
      const onlyToolResults = next.content.every((b) => b.type === "tool_result");
      if (!onlyToolResults) break;
      const refIds = next.content
        .filter((b): b is ToolResultBlock => b.type === "tool_result")
        .map((b) => b.tool_use_id);
      const allOrphan = refIds.length > 0 && refIds.every((id) => !allowedIds.has(id));
      if (!allOrphan) break;
      this.messages.splice(1, 1);
    }
  }
}
