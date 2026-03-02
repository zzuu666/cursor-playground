/**
 * Phase 13: 轻量 token 估算，用于按 token 触发上下文压缩与 diagnostics。
 * 保守近似：英文约 4 字符/token，CJK 约 2 字符/token，混合按字符数估算。
 */
import type { ConversationMessage } from "./session.js";

function charCount(msg: ConversationMessage): number {
  if (msg.role === "user") {
    if (typeof msg.content === "string") return msg.content.length;
    return msg.content.reduce((sum, b) => {
      if (b.type === "text") return sum + b.text.length;
      if (b.type === "tool_result") return sum + b.content.length;
      return sum;
    }, 0);
  }
  return msg.content.reduce((sum, b) => {
    if (b.type === "text") return sum + b.text.length;
    if (b.type === "thinking") return sum + b.thinking.length;
    if (b.type === "tool_use") return sum + JSON.stringify(b.input).length + b.name.length;
    return sum;
  }, 0);
}

/**
 * 估算 messages 总 token 数。近似规则：约 4 字符/token（偏保守，适用于中英文混合）。
 */
export function estimateTokens(messages: ConversationMessage[]): number {
  const total = messages.reduce((sum, m) => sum + charCount(m), 0);
  return Math.ceil(total / 4);
}
