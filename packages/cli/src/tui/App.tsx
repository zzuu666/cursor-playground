/**
 * Phase 14: Ink TUI 根组件——状态栏、内容区、输入区，执行 runOneTurn、批准、退出写 transcript。
 */
import React, { useState, useCallback, useRef } from "react";
import { Box, Text } from "ink";
import { StatusBar } from "./StatusBar.js";
import { ContentArea, messagesToDisplayLines } from "./ContentArea.js";
import { InputArea } from "./InputArea.js";
import type { TuiOptions } from "./types.js";
import { estimateTokens } from "../agent/token-estimate.js";
import { LoopLimitError, LoopSpinDetectedError } from "../infra/errors.js";
import { appendErrorLog } from "../infra/logger.js";

export interface AppProps {
  options: TuiOptions;
}

export function App({ options }: AppProps): React.ReactElement {
  const {
    resolved,
    provider,
    session,
    runOneTurn,
    sessionId,
    transcriptDir,
    writeTranscript,
    transcriptMeta,
    stream,
  } = options;

  const [inputValue, setInputValue] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [approvalPrompt, setApprovalPrompt] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pendingApprovalResolve = useRef<
    ((v: { approved: boolean; reason?: string }) => void) | null
  >(null);

  const messages = session.getMessages();
  const displayLines = messagesToDisplayLines(messages);
  const estimatedTokens = estimateTokens(messages);
  const autoMemory = options.transcriptMeta.autoMemoryLoaded;

  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      setInputValue("");

      if (pendingApprovalResolve.current) {
        const lower = trimmed.toLowerCase();
        const approved = lower === "y" || lower === "yes";
        let reason: string | undefined;
        if (!approved && (lower.startsWith("n") || lower === "no")) {
          const afterN = trimmed.slice(1).trim();
          if (afterN) reason = afterN;
        }
        pendingApprovalResolve.current(
          reason !== undefined ? { approved, reason } : { approved }
        );
        pendingApprovalResolve.current = null;
        setApprovalPrompt(null);
        return;
      }

      if (trimmed.length === 0) {
        await options.onExit();
        process.exit(0);
        return;
      }

      setErrorMessage(null);
      setIsRunning(true);
      setStreamingText("");

      const onApprovalRequest =
        resolved.approval === "prompt"
          ? (toolName: string, _inputSummary: string) =>
              new Promise<{ approved: boolean; reason?: string }>((resolve) => {
                pendingApprovalResolve.current = resolve;
                setApprovalPrompt(
                  `[approval] Approve tool "${toolName}"? (y/n or n <reason>): `
                );
              })
          : undefined;

      try {
        const overrides: Parameters<typeof runOneTurn>[1] = {};
        if (stream && provider.streamComplete) {
          overrides.onStreamText = (delta: string) =>
            setStreamingText((prev) => prev + delta);
        }
        if (onApprovalRequest != null) overrides.onApprovalRequest = onApprovalRequest;
        const result = await runOneTurn(trimmed, overrides);
        setStreamingText("");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMessage(msg);
        setStreamingText("");
        if (
          err instanceof LoopSpinDetectedError ||
          err instanceof LoopLimitError
        ) {
          const meta = {
            ...(err instanceof LoopSpinDetectedError && { spinDetected: true }),
            error: {
              name: err.name,
              message: err.message,
            },
          };
          const transcriptPath = await writeTranscript(transcriptDir, {
            sessionId,
            createdAt: new Date().toISOString(),
            provider: provider.name,
            policy: resolved.policy,
            messages: session.getMessages(),
            meta,
            ...transcriptMeta,
          });
          await appendErrorLog(transcriptDir, {
            sessionId,
            timestamp: new Date().toISOString(),
            name: err.name,
            message: err.message,
            transcriptPath,
          });
        }
      } finally {
        setIsRunning(false);
      }
    },
    [
      resolved.approval,
      provider,
      runOneTurn,
      stream,
      sessionId,
      transcriptDir,
      writeTranscript,
      transcriptMeta,
      session,
      options.onExit,
    ]
  );

  return (
    <Box flexDirection="column" width={100} minHeight={20}>
      <StatusBar
        provider={resolved.provider}
        model={resolved.model}
        approval={resolved.approval}
        messageCount={messages.length}
        estimatedTokens={estimatedTokens}
        autoMemory={autoMemory}
      />
      <ContentArea
        displayLines={displayLines}
        streamingText={streamingText}
        approvalPrompt={approvalPrompt ?? undefined}
      />
      {errorMessage != null && (
        <Box paddingY={1}>
          <Text color="red">error: {errorMessage}</Text>
        </Box>
      )}
      <InputArea
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleSubmit}
        placeholder={isRunning ? "..." : "Type a message (empty line to exit)"}
      />
    </Box>
  );
}
