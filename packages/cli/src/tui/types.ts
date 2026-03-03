/**
 * Phase 14: TUI 选项与共享类型。
 */
import type { AgentLoop } from "../agent/loop.js";
import type { LoopResult } from "../agent/loop.js";
import type { AgentSession } from "../agent/session.js";
import type { ResolvedConfig } from "../config.js";
import type { TranscriptPayload } from "../infra/logger.js";
import type { ChatProvider } from "../providers/base.js";
import type { ToolRegistry } from "../tools/registry.js";

/** 单次运行的选项覆盖（流式回调和批准回调由 TUI 注入）。 */
export interface RunOneTurnOverrides {
  onStreamText?: (delta: string) => void;
  onApprovalRequest?: (
    toolName: string,
    inputSummary: string
  ) => Promise<{ approved: boolean; reason?: string }>;
}

/** 供 TUI 调用的「执行一轮」函数：固定 loop/session/provider，仅覆盖 stream 与 approval。 */
export type RunOneTurnFn = (
  prompt: string,
  overrides: RunOneTurnOverrides
) => Promise<LoopResult>;

export interface AutoMemoryLoaded {
  enabled: boolean;
  lineCount: number;
  path?: string;
}

/** TUI 入口所需参数，与 index 中 REPL 上下文对齐。 */
export interface TuiOptions {
  resolved: ResolvedConfig;
  provider: ChatProvider;
  session: AgentSession;
  loop: AgentLoop;
  registry: ToolRegistry;
  /** 执行一轮对话，TUI 注入 onStreamText / onApprovalRequest。 */
  runOneTurn: RunOneTurnFn;
  getMemoryFragment: () => Promise<string>;
  sessionId: string;
  transcriptDir: string;
  writeTranscript: (dir: string, payload: TranscriptPayload) => Promise<string>;
  /** 退出时写入 transcript 的 meta 字段。 */
  transcriptMeta: {
    skillsLoaded?: { path: string; charCount: number }[];
    pluginsLoaded?: { path: string; name: string }[];
    mcpServersLoaded?: { name: string; tools: string[] }[];
    claudeMdLoaded?: { path: string; source: "project" | "user" | "local"; lineCount?: number }[];
    autoMemoryLoaded?: AutoMemoryLoaded;
  };
  /** 是否启用流式输出。 */
  stream: boolean;
  /** 退出 TUI 时调用（写 transcript、clearSessionId 等），在 unmount 前 await。 */
  onExit: () => Promise<void>;
}
