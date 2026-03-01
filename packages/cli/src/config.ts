import { config as loadDotenv } from "dotenv";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LoopPolicy } from "./agent/policy.js";
import { DEFAULT_LOOP_POLICY } from "./agent/policy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_BASE_URL = "https://api.minimax.io/anthropic";
const DEFAULT_MODEL = "MiniMax-M2.5";
const DEFAULT_PROVIDER = "minimax";

const CONFIG_FILE_NAMES = ["mini-agent.config.json", ".mini-agent.json"] as const;

/** 用户批准策略：never 禁止需批准的工具；auto 自动通过；prompt 每次等待用户 y/n。 */
export type ApprovalMode = "never" | "auto" | "prompt";

const APPROVAL_MODES: ApprovalMode[] = ["never", "auto", "prompt"];
const DEFAULT_APPROVAL: ApprovalMode = "auto";

function parseApprovalMode(value: unknown): ApprovalMode | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim().toLowerCase();
  if (APPROVAL_MODES.includes(s as ApprovalMode)) return s as ApprovalMode;
  return undefined;
}

/** Config file schema (all optional). */
export interface ConfigFile {
  provider?: string;
  model?: string;
  transcriptDir?: string;
  baseURL?: string;
  policy?: Partial<LoopPolicy>;
  approval?: ApprovalMode;
  /** 允许 execute_command 执行的可执行名列表，如 ["npm","node"]；不设则用内置默认列表。 */
  allowedCommands?: string[];
  /** Skill 文件或目录路径列表，用于加载 SKILL.md / skill.json 并注入 system prompt。 */
  skillPaths?: string[];
}

/** Resolved run config after merging defaults → config file → env → CLI. */
export interface ResolvedConfig {
  provider: string;
  model: string;
  transcriptDir: string;
  baseURL: string;
  policy: LoopPolicy;
  approval: ApprovalMode;
  verbose: boolean;
  dryRun: boolean;
  /** 仅来自配置文件；不设则工具使用内置默认白名单。 */
  allowedCommands?: string[];
  /** 合并后的 Skill 路径列表（配置 + CLI 追加）。 */
  skillPaths?: string[];
  /** 合并默认 SYSTEM_PROMPT 与 Skill 片段后的完整 system prompt；由入口在 loadConfig 后填充。 */
  systemPrompt?: string;
}

export interface MinimaxConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

/** OpenAI 兼容 API 的配置（OpenAI、DeepSeek 等）。 */
export interface OpenAICompatibleConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

export interface LoadConfigOptions {
  /** Explicit config file path (if set, only this path is used; must exist). */
  configPath?: string;
  cwd: string;
  /** 默认 transcript 输出目录；不设则用 join(cwd, "transcripts")。设为 CLI 包根下 transcripts 可避免从仓库根运行时写到根目录。 */
  defaultTranscriptDir?: string;
  /** CLI overrides (highest priority). */
  cli?: Partial<
    Pick<ResolvedConfig, "provider" | "model" | "transcriptDir" | "approval" | "verbose" | "dryRun" | "skillPaths"> & {
      policy?: Partial<LoopPolicy>;
    }
  >;
}

let loaded = false;
function ensureEnvLoaded(): void {
  if (!loaded) {
    loadDotenv({ path: join(__dirname, "..", ".env") });
    loaded = true;
  }
}

function mergePolicy(base: LoopPolicy, overrides: Partial<LoopPolicy> | undefined): LoopPolicy {
  if (!overrides || Object.keys(overrides).length === 0) return base;
  return { ...base, ...overrides };
}

/**
 * Find config file path: either explicit path or first existing in cwd.
 * Returns undefined if no explicit path and no file found.
 */
function resolveConfigPath(configPath: string | undefined, cwd: string): string | undefined {
  if (configPath != null && configPath.trim() !== "") {
    return configPath;
  }
  for (const name of CONFIG_FILE_NAMES) {
    const p = join(cwd, name);
    if (existsSync(p)) return p;
  }
  return undefined;
}

/**
 * Load and parse config file. Throws on read or parse error.
 */
async function readConfigFile(filePath: string): Promise<ConfigFile> {
  const raw = await readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Config file must export a JSON object.");
  }
  const obj = parsed as Record<string, unknown>;
  const config: ConfigFile = {};
  if (typeof obj.provider === "string") config.provider = obj.provider;
  if (typeof obj.model === "string") config.model = obj.model;
  if (typeof obj.transcriptDir === "string") config.transcriptDir = obj.transcriptDir;
  if (typeof obj.baseURL === "string") config.baseURL = obj.baseURL;
  const approval = parseApprovalMode(obj.approval);
  if (approval != null) config.approval = approval;
  if (typeof obj.policy === "object" && obj.policy !== null) {
    const p = obj.policy as Record<string, unknown>;
    config.policy = {};
    if (typeof p.maxTurns === "number") config.policy.maxTurns = p.maxTurns;
    if (typeof p.maxToolCalls === "number") config.policy.maxToolCalls = p.maxToolCalls;
    if (typeof p.toolTimeoutMs === "number") config.policy.toolTimeoutMs = p.toolTimeoutMs;
    if (typeof p.maxRetries === "number") config.policy.maxRetries = p.maxRetries;
    if (typeof p.retryDelayMs === "number") config.policy.retryDelayMs = p.retryDelayMs;
    if (typeof p.maxSameToolRepeat === "number") config.policy.maxSameToolRepeat = p.maxSameToolRepeat;
    if (typeof p.summaryThreshold === "number") config.policy.summaryThreshold = p.summaryThreshold;
    if (typeof p.summaryKeepRecent === "number") config.policy.summaryKeepRecent = p.summaryKeepRecent;
  }
  if (Array.isArray(obj.allowedCommands)) {
    const list = (obj.allowedCommands as unknown[]).filter((x): x is string => typeof x === "string");
    if (list.length > 0) config.allowedCommands = list;
  }
  if (Array.isArray(obj.skillPaths)) {
    const list = (obj.skillPaths as unknown[]).filter((x): x is string => typeof x === "string");
    if (list.length > 0) config.skillPaths = list;
  }
  return config;
}

/**
 * Load config with merge order: defaults → config file → env → CLI.
 * When configPath is explicitly provided and file is missing/invalid, throws (caller should set exit 2).
 */
export async function loadConfig(options: LoadConfigOptions): Promise<ResolvedConfig> {
  const { configPath, cwd, defaultTranscriptDir, cli = {} } = options;
  ensureEnvLoaded();

  const defaults: ResolvedConfig = {
    provider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    transcriptDir: defaultTranscriptDir ?? join(cwd, "transcripts"),
    baseURL: DEFAULT_BASE_URL,
    policy: { ...DEFAULT_LOOP_POLICY },
    approval: DEFAULT_APPROVAL,
    verbose: false,
    dryRun: false,
  };

  let merged: ResolvedConfig = { ...defaults, policy: { ...defaults.policy } };

  const filePath = resolveConfigPath(configPath, cwd);
  if (filePath !== undefined) {
    if (!existsSync(filePath)) {
      throw new Error(`Config file not found: ${filePath}`);
    }
    const fileConfig = await readConfigFile(filePath);
    if (fileConfig.provider != null) merged.provider = fileConfig.provider;
    if (fileConfig.model != null) merged.model = fileConfig.model;
    if (fileConfig.transcriptDir != null) merged.transcriptDir = fileConfig.transcriptDir;
    if (fileConfig.baseURL != null) merged.baseURL = fileConfig.baseURL;
    if (fileConfig.approval != null) merged.approval = fileConfig.approval;
    if (fileConfig.allowedCommands != null) merged.allowedCommands = fileConfig.allowedCommands;
    if (fileConfig.skillPaths != null) merged.skillPaths = [...fileConfig.skillPaths];
    merged.policy = mergePolicy(merged.policy, fileConfig.policy);
  }

  const envBaseURL = process.env.MINIMAX_BASE_URL?.trim();
  const envModel = process.env.MINIMAX_MODEL?.trim();
  const envTranscriptDir = process.env.TRANSCRIPT_DIR?.trim();
  if (envBaseURL) merged.baseURL = envBaseURL;
  if (envModel) merged.model = envModel;
  if (envTranscriptDir) merged.transcriptDir = envTranscriptDir;

  if (cli.provider != null) merged.provider = cli.provider;
  if (cli.model != null) merged.model = cli.model;
  if (cli.transcriptDir != null) merged.transcriptDir = cli.transcriptDir;
  if (cli.approval != null) merged.approval = cli.approval;
  if (cli.verbose != null) merged.verbose = cli.verbose;
  if (cli.dryRun != null) merged.dryRun = cli.dryRun;
  if (cli.policy != null) merged.policy = mergePolicy(merged.policy, cli.policy);
  if (cli.skillPaths != null) {
    merged.skillPaths = [...(merged.skillPaths ?? []), ...cli.skillPaths];
  }

  return merged;
}

export function getMinimaxConfig(resolved?: Pick<ResolvedConfig, "baseURL" | "model">): MinimaxConfig {
  ensureEnvLoaded();
  const apiKey = process.env.MINIMAX_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "MINIMAX_API_KEY is required. Set it in environment or in packages/cli/.env (see .env.example)."
    );
  }
  return {
    apiKey,
    baseURL: resolved?.baseURL ?? process.env.MINIMAX_BASE_URL?.trim() ?? DEFAULT_BASE_URL,
    model: resolved?.model ?? process.env.MINIMAX_MODEL?.trim() ?? DEFAULT_MODEL,
  };
}

export function hasMinimaxApiKey(): boolean {
  ensureEnvLoaded();
  return Boolean(process.env.MINIMAX_API_KEY?.trim());
}

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com";
const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";
const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_DEFAULT_MODEL = "deepseek-chat";

/**
 * 获取 OpenAI 兼容 API 的配置（用于 provider openai 或 deepseek）。
 * apiKey 来自对应 env；baseURL/model 优先 env，其次 resolved.model，最后默认值。
 */
export function getOpenAICompatibleConfig(
  providerId: "openai" | "deepseek",
  resolved: Pick<ResolvedConfig, "model">
): OpenAICompatibleConfig {
  ensureEnvLoaded();
  if (providerId === "openai") {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY is required for provider 'openai'. Set it in environment or in packages/cli/.env."
      );
    }
    const baseURL = process.env.OPENAI_BASE_URL?.trim() || OPENAI_DEFAULT_BASE_URL;
    const model = process.env.OPENAI_MODEL?.trim() || resolved.model || OPENAI_DEFAULT_MODEL;
    return { apiKey, baseURL, model };
  }
  // deepseek
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "DEEPSEEK_API_KEY is required for provider 'deepseek'. Set it in environment or in packages/cli/.env."
    );
  }
  const baseURL = process.env.DEEPSEEK_BASE_URL?.trim() || DEEPSEEK_DEFAULT_BASE_URL;
  const model = process.env.DEEPSEEK_MODEL?.trim() || resolved.model || DEEPSEEK_DEFAULT_MODEL;
  return { apiKey, baseURL, model };
}
