import { describe, it, expect } from "vitest";
import { estimateTokens } from "../src/agent/token-estimate.js";
import type { ConversationMessage } from "../src/agent/session.js";

function makeUserMessage(content: string): ConversationMessage {
  return {
    role: "user",
    content,
  };
}

function makeAssistantText(content: string): ConversationMessage {
  return {
    role: "assistant",
    content: [
      {
        type: "text",
        text: content,
      },
    ],
  };
}

describe("estimateTokens", () => {
  it("returns 0 for empty messages", () => {
    expect(estimateTokens([])).toBe(0);
  });

  it("increases with longer content (user)", () => {
    const short = [makeUserMessage("hello")];
    const long = [makeUserMessage("hello".repeat(10))];

    const shortTokens = estimateTokens(short);
    const longTokens = estimateTokens(long);

    expect(shortTokens).toBeGreaterThan(0);
    expect(longTokens).toBeGreaterThan(shortTokens);
  });

  it("handles assistant text blocks", () => {
    const msgs = [
      makeAssistantText("short"),
      makeAssistantText("this is a considerably longer assistant message"),
    ];
    const tokens = estimateTokens(msgs);
    expect(tokens).toBeGreaterThan(0);
  });

  it("handles mixed CJK and ASCII text", () => {
    const msgs = [makeUserMessage("你好，world")];
    const tokens = estimateTokens(msgs);
    expect(tokens).toBeGreaterThan(0);
  });
});

