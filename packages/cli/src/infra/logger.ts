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

interface TranscriptPayload {
  createdAt: string;
  provider: string;
  policy: {
    maxTurns: number;
    maxToolCalls: number;
    toolTimeoutMs: number;
  };
  messages: ConversationMessage[];
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
