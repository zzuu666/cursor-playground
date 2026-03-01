import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConversationMessage } from "../agent/session.js";

const REDACT_PLACEHOLDER = "***";

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

export interface TranscriptMeta {
  spinDetected?: boolean;
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
  createdAt: string;
  provider: string;
  policy: object;
  messages: ConversationMessage[];
  result?: TranscriptResult;
  meta?: TranscriptMeta;
  /** 本次 run 内发生的工具批准/拒绝记录。 */
  approvalLog?: ApprovalLogEntry[];
}

export async function writeTranscript(
  dir: string,
  payload: TranscriptPayload
): Promise<string> {
  await mkdir(dir, { recursive: true });

  const safe = redactObject(payload) as TranscriptPayload;
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
  const safeInput = redactObject(input as Record<string, unknown>);
  const inputStr = truncate(JSON.stringify(safeInput), MAX_LOG_SNIPPET);
  process.stderr.write(`[tool] ${name} input: ${inputStr}\n`);
  if (outcome.ok) {
    process.stderr.write(`[tool] ${name} ok ${outcome.bytes} bytes\n`);
  } else {
    const errStr = truncate(redactForLog(outcome.error), MAX_LOG_SNIPPET);
    process.stderr.write(`[tool] ${name} error: ${errStr}\n`);
  }
}

export function logStreamTurn(turn: number, phase: "start" | "end"): void {
  process.stderr.write(`[stream] turn ${turn} ${phase}\n`);
}

export function logTurnDiagnostics(
  turn: number,
  toolCount: number,
  elapsedMs: number
): void {
  process.stderr.write(
    `[turn ${turn}] tools=${toolCount}, elapsed=${elapsedMs}ms\n`
  );
}
