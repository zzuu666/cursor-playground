/**
 * Phase 14: TUI 状态栏——展示 provider、model、approval、上下文条数、token 估算、Auto Memory。
 */
import React from "react";
import { Box, Text } from "ink";
import type { AutoMemoryLoaded } from "./types.js";
import type { AgentMode } from "../config.js";
import { AGENT_MODE } from "../config.js";

export interface StatusBarProps {
  provider: string;
  model: string;
  approval: string;
  /** Current run mode: agent | plan. */
  mode: AgentMode;
  messageCount: number;
  estimatedTokens: number;
  autoMemory: AutoMemoryLoaded | undefined;
}

export function StatusBar({
  provider,
  model,
  approval,
  mode,
  messageCount,
  estimatedTokens,
  autoMemory,
}: StatusBarProps): React.ReactElement {
  const memoryStr = autoMemory?.enabled
    ? `Memory: on (${autoMemory.lineCount} lines)`
    : "Memory: off";
  const modeLabel = mode === AGENT_MODE.Plan ? "Plan" : "Agent";
  const line = [
    `${provider} / ${model}`,
    `mode=${modeLabel}`,
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
