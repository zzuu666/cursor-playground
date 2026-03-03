/**
 * Phase 14: TUI 主内容区——历史对话、当前轮次流式输出、工具调用与结果摘要。
 */
import React from "react";
import { Box, Text } from "ink";
import type { ConversationMessage } from "../agent/session.js";

export interface ContentAreaProps {
  /** 用于展示的对话行（已格式化的字符串数组，便于滚动/截断）。 */
  displayLines: string[];
  /** 当前轮次流式输出的片段（未结束）。 */
  streamingText: string;
  /** 是否正在等待用户批准工具（显示批准提示文案）。 */
  approvalPrompt?: string | undefined;
}

function messageToDisplayLines(messages: ConversationMessage[]): string[] {
  const lines: string[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        lines.push(`You: ${msg.content.slice(0, 200)}${msg.content.length > 200 ? "..." : ""}`);
      } else {
        const parts = msg.content
          .filter((b) => b.type === "tool_result")
          .map((b) => (b.type === "tool_result" ? `[tool_result] ${b.content.slice(0, 80)}...` : ""));
        if (parts.length) lines.push(parts.join(" "));
      }
    } else {
      for (const block of msg.content) {
        if (block.type === "text") {
          lines.push(`Assistant: ${block.text.slice(0, 300)}${block.text.length > 300 ? "..." : ""}`);
        } else if (block.type === "tool_use") {
          lines.push(`[tool] ${block.name}`);
        }
      }
    }
  }
  return lines;
}

/** 从 messages 生成 displayLines（供 App 预计算或本组件内部用）。 */
export function messagesToDisplayLines(messages: ConversationMessage[]): string[] {
  return messageToDisplayLines(messages);
}

export function ContentArea({
  displayLines,
  streamingText,
  approvalPrompt,
}: ContentAreaProps): React.ReactElement {
  const allLines = [...displayLines];
  if (streamingText) allLines.push(`Assistant: ${streamingText}`);
  if (approvalPrompt) allLines.push(approvalPrompt);
  const take = 50;
  const shown = allLines.length > take ? allLines.slice(-take) : allLines;
  return (
    <Box flexGrow={1} flexDirection="column" overflow="hidden" paddingY={1}>
      {shown.map((line, i) => (
        <Text key={i} wrap="truncate-end">
          {line}
        </Text>
      ))}
    </Box>
  );
}
