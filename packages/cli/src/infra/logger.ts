import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConversationMessage } from "../agent/session.js";

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

  const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const filePath = join(dir, fileName);
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  return filePath;
}
