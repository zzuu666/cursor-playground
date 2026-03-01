import { randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConversationMessage } from "../agent/session.js";

const REDACT_PLACEHOLDER = "***";

/** 生成一次 session 的唯一 UUID，用于 transcript、stderr 与 error 日志关联。 */
export function createSessionId(): string {
  return randomUUID();
}

let currentSessionId: string | undefined;

/** 设置当前 session 的 ID，后续 stderr 日志会带此前缀；session 结束时请调用 clearSessionId()。 */
export function setSessionId(id: string): void {
  currentSessionId = id;
}

/** 清除当前 session ID。 */
export function clearSessionId(): void {
  currentSessionId = undefined;
}

function logPrefix(): string {
  return currentSessionId != null ? `[${currentSessionId}] ` : "";
}

const SENSITIVE_KEYS = new Set([
  "apikey",
  "api_key",
  "api-key",
  "minimax_api_key",
  "secret",
  "token",
  "authorization",
]);

function isLikelyKeyValue(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (s.length < 20) return false;
  return /^[a-zA-Z0-9_-]+$/.test(s) || /^sk-[a-zA-Z0-9-]+$/.test(s);
}

function redactObject(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") {
    if (typeof obj === "string" && isLikelyKeyValue(obj)) return REDACT_PLACEHOLDER;
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(redactObject);
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lower) || lower.includes("key") || lower.includes("secret") || lower.includes("token")) {
      out[key] = REDACT_PLACEHOLDER;
    } else {
      out[key] = redactObject(val);
    }
  }
  return out;
}

export interface TranscriptResult {
  turns: number;
  toolCalls: number;
  diagnostics: Array<{ turn: number; toolCount: number; elapsedMs: number }>;
  elapsedTotalMs: number;
}

/** 记录到 transcript 的终止错误，便于审计与排查。 */
export interface TranscriptError {
  name: string;
  message: string;
}

export interface TranscriptMeta {
  spinDetected?: boolean;
  /** 本次 run 因错误终止时的错误信息。 */
  error?: TranscriptError;
}

/** 单次工具批准/拒绝记录，用于 transcript 审计。 */
export interface ApprovalLogEntry {
  toolName: string;
  inputSummary: string;
  decision: "approved" | "rejected";
  userReason?: string;
  timestamp?: string;
}

export interface TranscriptPayload {
  /** 本次 session 的唯一 ID，便于与 stderr 及 error 日志关联。 */
  sessionId: string;
  createdAt: string;
  provider: string;
  policy: object;
  messages: ConversationMessage[];
  result?: TranscriptResult;
  meta?: TranscriptMeta;
  /** 本次 run 内发生的工具批准/拒绝记录。 */
  approvalLog?: ApprovalLogEntry[];
  /** 本次 run 加载的 Skill 路径与字符数摘要，便于审计。 */
  skillsLoaded?: { path: string; charCount: number }[];
  /** 本次 run 加载的插件路径与 manifest name，便于审计。 */
  pluginsLoaded?: { path: string; name: string }[];
}

/** 独立 error 日志单条，写入 errors.jsonl。 */
export interface ErrorLogEntry {
  sessionId: string;
  timestamp: string;
  name: string;
  message: string;
  transcriptPath?: string;
}

const ERROR_LOG_FILE = "errors.jsonl";

/** 追加一条错误到 transcriptDir 下的 errors.jsonl，与 transcript 解耦；message 会脱敏。 */
export async function appendErrorLog(
  dir: string,
  entry: ErrorLogEntry
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, ERROR_LOG_FILE);
  const safe = {
    sessionId: entry.sessionId,
    timestamp: entry.timestamp,
    name: entry.name,
    message: redactForLog(entry.message),
    ...(entry.transcriptPath != null && { transcriptPath: entry.transcriptPath }),
  };
  await appendFile(filePath, `${JSON.stringify(safe)}\n`, "utf-8");
}

export async function writeTranscript(
  dir: string,
  payload: TranscriptPayload
): Promise<string> {
  await mkdir(dir, { recursive: true });

  const safe = redactObject(payload) as TranscriptPayload;
  // Keep sessionId and provider as-is for correlation and debugging (do not redact)
  safe.sessionId = payload.sessionId;
  safe.provider = payload.provider;
  const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const filePath = join(dir, fileName);
  await writeFile(filePath, `${JSON.stringify(safe, null, 2)}\n`, "utf-8");
  return filePath;
}

export function redactForLog(text: string): string {
  return text.replace(/sk-[a-zA-Z0-9-]{20,}/g, REDACT_PLACEHOLDER).replace(
    /\b[A-Za-z0-9_-]{32,}\b/g,
    REDACT_PLACEHOLDER
  );
}

const MAX_LOG_SNIPPET = 200;

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "...";
}

export type ToolCallOutcome =
  | { ok: true; bytes: number }
  | { ok: false; error: string };

export function logToolCall(
  name: string,
  input: unknown,
  outcome: ToolCallOutcome
): void {
  const prefix = logPrefix();
  const safeInput = redactObject(input as Record<string, unknown>);
  const inputStr = truncate(JSON.stringify(safeInput), MAX_LOG_SNIPPET);
  process.stderr.write(`${prefix}[tool] ${name} input: ${inputStr}\n`);
  if (outcome.ok) {
    process.stderr.write(`${prefix}[tool] ${name} ok ${outcome.bytes} bytes\n`);
  } else {
    const errStr = truncate(redactForLog(outcome.error), MAX_LOG_SNIPPET);
    process.stderr.write(`${prefix}[tool] ${name} error: ${errStr}\n`);
  }
}

export function logStreamTurn(turn: number, phase: "start" | "end"): void {
  process.stderr.write(`${logPrefix()}[stream] turn ${turn} ${phase}\n`);
}

export function logTurnDiagnostics(
  turn: number,
  toolCount: number,
  elapsedMs: number
): void {
  process.stderr.write(
    `${logPrefix()}[turn ${turn}] tools=${toolCount}, elapsed=${elapsedMs}ms\n`
  );
}
