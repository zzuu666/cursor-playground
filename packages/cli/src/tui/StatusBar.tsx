/**
 * Phase 14: TUI 状态栏——展示 provider、model、approval、上下文条数、token 估算、Auto Memory。
 */
import React from "react";
import { Box, Text } from "ink";
import type { AutoMemoryLoaded } from "./types.js";

export interface StatusBarProps {
  provider: string;
  model: string;
  approval: string;
  messageCount: number;
  estimatedTokens: number;
  autoMemory: AutoMemoryLoaded | undefined;
}

export function StatusBar({
  provider,
  model,
  approval,
  messageCount,
  estimatedTokens,
  autoMemory,
}: StatusBarProps): React.ReactElement {
  const memoryStr = autoMemory?.enabled
    ? `Memory: on (${autoMemory.lineCount} lines)`
    : "Memory: off";
  const line = [
    `${provider} / ${model}`,
    `approval=${approval}`,
    `msgs=${messageCount}`,
    `tokens≈${estimatedTokens}`,
    memoryStr,
  ].join("  ");
  return (
    <Box borderStyle="single" borderColor="cyan">
      <Text dimColor>{line}</Text>
    </Box>
  );
}
