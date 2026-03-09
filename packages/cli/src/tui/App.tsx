/**
 * Phase 14: Ink TUI 根组件——内容区、输入区、状态栏（输入框下方），执行 runOneTurn、批准、退出写 transcript。
 */
import React, { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { StatusBar } from "./StatusBar.js";
import { ContentArea, messagesToDisplayLines } from "./ContentArea.js";
import { InputArea } from "./InputArea.js";
import type { TuiOptions } from "./types.js";
import type { AgentMode } from "../config.js";
import { AGENT_MODE } from "../config.js";
import { estimateTokens } from "../agent/token-estimate.js";
import { LoopLimitError, LoopSpinDetectedError } from "../infra/errors.js";
import { appendErrorLog } from "../infra/logger.js";
import { dispatchSlash, EXIT_SENTINEL, getFilteredSlashHints } from "../commands/slash.js";

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
  const [slashMessage, setSlashMessage] = useState<string | null>(null);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [currentMode, setCurrentMode] = useState<AgentMode>(
    () => options.resolved.mode ?? AGENT_MODE.Agent
  );
  const pendingApprovalResolve = useRef<
    ((v: { approved: boolean; reason?: string }) => void) | null
  >(null);
  const refEnterSelect = useRef(false);

  const messages = session.getMessages();
  const displayLines = messagesToDisplayLines(messages);
  const estimatedTokens = estimateTokens(messages);
  const autoMemory = options.transcriptMeta.autoMemoryLoaded;

  const slashHints = useMemo(
    () => (inputValue.startsWith("/") ? getFilteredSlashHints(options.skills, inputValue) : []),
    [inputValue, options.skills]
  );

  useEffect(() => {
    if (slashHints.length === 0) return;
    setSlashSelectedIndex((i) => Math.min(i, slashHints.length - 1));
  }, [slashHints.length]);

  useEffect(() => {
    if (inputValue.startsWith("/")) setSlashSelectedIndex(0);
  }, [inputValue]);

  useInput((_input, key) => {
    if (key.tab && key.shift) {
      setCurrentMode((prev) =>
        prev === AGENT_MODE.Agent ? AGENT_MODE.Plan : AGENT_MODE.Agent
      );
      return;
    }
    if (slashHints.length > 0) {
      if (key.upArrow) {
        setSlashSelectedIndex((i) => (i <= 0 ? slashHints.length - 1 : i - 1));
        return;
      }
      if (key.downArrow) {
        setSlashSelectedIndex((i) => (i >= slashHints.length - 1 ? 0 : i + 1));
        return;
      }
      if (key.return) {
        const selected = slashHints[slashSelectedIndex];
        if (selected) {
          refEnterSelect.current = true;
          setInputValue(`/${selected.name} `);
        }
        return;
      }
    }
  });

  const handleSubmit = useCallback(
    async (value: string) => {
      if (refEnterSelect.current) {
        refEnterSelect.current = false;
        return;
      }
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
      setSlashMessage(null);

      // Slash command dispatch
      if (trimmed.startsWith("/")) {
        const slashResult = await dispatchSlash(trimmed, {
          session,
          policy: resolved.policy,
          skills: options.skills,
        });
        if (slashResult.handled) {
          if (slashResult.message === EXIT_SENTINEL) {
            await options.onExit();
            process.exit(0);
            return;
          }
          setSlashMessage(slashResult.message);
          return;
        }
        // For skill invocations, fall through with rewritten prompt
        setIsRunning(true);
        setStreamingText("");

        const onApprovalRequest2 =
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
          const overrides2: Parameters<typeof runOneTurn>[1] = {
            mode: currentMode,
          };
          if (stream && provider.streamComplete) {
            overrides2.onStreamText = (delta: string) =>
              setStreamingText((prev) => prev + delta);
          }
          if (onApprovalRequest2 != null) overrides2.onApprovalRequest = onApprovalRequest2;
          await runOneTurn(slashResult.prompt, overrides2);
          setStreamingText("");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setErrorMessage(msg);
          setStreamingText("");
        } finally {
          setIsRunning(false);
        }
        return;
      }

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
        const overrides: Parameters<typeof runOneTurn>[1] = {
          mode: currentMode,
        };
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
      resolved.policy,
      provider,
      runOneTurn,
      stream,
      currentMode,
      sessionId,
      transcriptDir,
      writeTranscript,
      transcriptMeta,
      session,
      options.onExit,
      options.skills,
    ]
  );

  return (
    <Box flexDirection="column" width={100} minHeight={20}>
      <ContentArea
        displayLines={displayLines}
        streamingText={streamingText}
        approvalPrompt={approvalPrompt ?? undefined}
      />
      {slashMessage != null && (
        <Box paddingY={1}>
          <Text color="cyan">{slashMessage}</Text>
        </Box>
      )}
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
      {inputValue.startsWith("/") && slashHints.length > 0 && (
        <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
          {slashHints.map((h, i) => (
            <Text key={h.name} inverse={i === slashSelectedIndex}>
              /{h.name}
              {" — "}
              <Text color="gray">{h.description}</Text>
            </Text>
          ))}
        </Box>
      )}
      <StatusBar
        provider={resolved.provider}
        model={resolved.model}
        approval={resolved.approval}
        mode={currentMode}
        messageCount={messages.length}
        estimatedTokens={estimatedTokens}
        autoMemory={autoMemory}
      />
    </Box>
  );
}
