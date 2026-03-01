import { config as loadDotenv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_BASE_URL = "https://api.minimax.io/anthropic";
const DEFAULT_MODEL = "MiniMax-M2.5";

export interface MinimaxConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

let loaded = false;
function ensureEnvLoaded(): void {
  if (!loaded) {
    loadDotenv({ path: join(__dirname, "..", ".env") });
    loaded = true;
  }
}

export function getMinimaxConfig(): MinimaxConfig {
  ensureEnvLoaded();
  const apiKey = process.env.MINIMAX_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "MINIMAX_API_KEY is required. Set it in environment or in packages/cli/.env (see .env.example)."
    );
  }
  return {
    apiKey,
    baseURL: process.env.MINIMAX_BASE_URL?.trim() ?? DEFAULT_BASE_URL,
    model: process.env.MINIMAX_MODEL?.trim() ?? DEFAULT_MODEL,
  };
}

export function hasMinimaxApiKey(): boolean {
  ensureEnvLoaded();
  return Boolean(process.env.MINIMAX_API_KEY?.trim());
}
