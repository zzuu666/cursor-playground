import { config as loadDotenv } from "dotenv";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LoopPolicy } from "./agent/policy.js";
import { DEFAULT_LOOP_POLICY } from "./agent/policy.js";
import { expandMcpServerConfig } from "./mcp/env-expand.js";

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

/** MCP 服务配置：stdio（本地进程）或 http（远程），与 Claude Code / .mcp.json 兼容。 */
export interface McpServerConfigStdio {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpServerConfigHttp {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpServerConfigStdio | McpServerConfigHttp;

/** 判断是否为 HTTP 配置（按 type 或缺少 command 判断）。 */
export function isMcpServerConfigHttp(c: McpServerConfig): c is McpServerConfigHttp {
  return c.type === "http";
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
  /** 全局 Skill 根目录列表（如 ~/.agents/skills、~/.cursor/skills）；若提供则完全替换默认列表。 */
  globalSkillDirs?: string[];
  /** 是否跳过加载全局 Skills。 */
  skipGlobalSkills?: boolean;
  /** 插件目录路径列表（Claude Code 式，含 .claude-plugin/plugin.json）；配置先，CLI 追加。 */
  pluginDirs?: string[];
  /** MCP 服务器配置（stdio / http），与 .mcp.json 格式一致。 */
  mcpServers?: Record<string, McpServerConfig>;
  /** 是否启用 Auto Memory（MEMORY.md 前 200 行每会话加载）；默认 true。 */
  autoMemoryEnabled?: boolean;
  /** 排除的 CLAUDE.md 路径或前缀（大 monorepo 用）。 */
  claudeMdExcludes?: string[];
  /** 覆盖 Auto Memory 根目录（默认 ~/.claude）。 */
  memoryPath?: string;
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
  /** 解析后的全局 Skill 根目录列表（绝对路径）；用于按子目录发现 skill。 */
  globalSkillDirs?: string[];
  /** 是否跳过加载全局 Skills。 */
  skipGlobalSkills?: boolean;
  /** 合并后的插件目录列表（配置 + CLI 追加）。 */
  pluginDirs?: string[];
  /** 合并后的 MCP 服务器配置（配置文件 + 项目 .mcp.json + 插件）。 */
  mcpServers?: Record<string, McpServerConfig>;
  /** 本次 run 启用的 MCP 服务器名称列表；未传 --mcp 时为 mcpServers 的全部 key。 */
  enabledMcpServerNames?: string[];
  /** 是否启用 Auto Memory；默认 true，可由 MINI_AGENT_DISABLE_AUTO_MEMORY=1 关闭。 */
  autoMemoryEnabled?: boolean;
  /** 排除的 CLAUDE.md 路径或前缀。 */
  claudeMdExcludes?: string[];
  /** 覆盖 Auto Memory 根目录。 */
  memoryPath?: string;
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
    Pick<
      ResolvedConfig,
      | "provider"
      | "model"
      | "transcriptDir"
      | "approval"
      | "verbose"
      | "dryRun"
      | "skillPaths"
      | "pluginDirs"
      | "enabledMcpServerNames"
      | "autoMemoryEnabled"
      | "claudeMdExcludes"
      | "memoryPath"
    > & {
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
/** 解析路径中的 ~ 为用户主目录（跨平台）。 */
function resolveTilde(path: string): string {
  if (path.startsWith("~")) {
    return join(homedir(), path.slice(1));
  }
  return path;
}

/** 默认全局 Skill 根目录：先 .agents 后 .cursor。 */
export function getDefaultGlobalSkillDirs(): string[] {
  const home = homedir();
  return [join(home, ".agents", "skills"), join(home, ".cursor", "skills")];
}

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
    if (typeof p.contextMaxTokens === "number") config.policy.contextMaxTokens = p.contextMaxTokens;
    if (p.compressStrategy === "message_count" || p.compressStrategy === "token_based") config.policy.compressStrategy = p.compressStrategy;
    if (typeof p.useLlmSummary === "boolean") config.policy.useLlmSummary = p.useLlmSummary;
    if (typeof p.compressWriteMemory === "boolean") config.policy.compressWriteMemory = p.compressWriteMemory;
    if (typeof p.llmSummaryTimeoutMs === "number") config.policy.llmSummaryTimeoutMs = p.llmSummaryTimeoutMs;
    if (typeof p.llmSummaryMaxInputChars === "number") config.policy.llmSummaryMaxInputChars = p.llmSummaryMaxInputChars;
  }
  if (Array.isArray(obj.allowedCommands)) {
    const list = (obj.allowedCommands as unknown[]).filter((x): x is string => typeof x === "string");
    if (list.length > 0) config.allowedCommands = list;
  }
  if (Array.isArray(obj.skillPaths)) {
    const list = (obj.skillPaths as unknown[]).filter((x): x is string => typeof x === "string");
    if (list.length > 0) config.skillPaths = list;
  }
  if (Array.isArray(obj.globalSkillDirs)) {
    const list = (obj.globalSkillDirs as unknown[]).filter((x): x is string => typeof x === "string");
    if (list.length > 0) config.globalSkillDirs = list;
  }
  if (typeof obj.skipGlobalSkills === "boolean") config.skipGlobalSkills = obj.skipGlobalSkills;
  if (Array.isArray(obj.pluginDirs)) {
    const list = (obj.pluginDirs as unknown[]).filter((x): x is string => typeof x === "string");
    if (list.length > 0) config.pluginDirs = list;
  }
  if (typeof obj.mcpServers === "object" && obj.mcpServers !== null && !Array.isArray(obj.mcpServers)) {
    const servers = obj.mcpServers as Record<string, unknown>;
    const mcpServers: Record<string, McpServerConfig> = {};
    for (const [name, entry] of Object.entries(servers)) {
      const c = parseOneMcpServerConfig(entry);
      if (c) mcpServers[name] = c;
    }
    if (Object.keys(mcpServers).length > 0) config.mcpServers = mcpServers;
  }
  if (typeof obj.autoMemoryEnabled === "boolean") config.autoMemoryEnabled = obj.autoMemoryEnabled;
  if (Array.isArray(obj.claudeMdExcludes)) {
    const list = (obj.claudeMdExcludes as unknown[]).filter((x): x is string => typeof x === "string");
    if (list.length > 0) config.claudeMdExcludes = list;
  }
  if (typeof obj.memoryPath === "string" && obj.memoryPath.trim())
    config.memoryPath = resolveTilde(obj.memoryPath.trim());
  return config;
}

/** 解析单条 MCP 服务配置（stdio 或 http），供 readMcpJsonFromPath 与插件 MCP 复用。 */
export function parseOneMcpServerConfig(entry: unknown): McpServerConfig | null {
  if (entry == null || typeof entry !== "object" || Array.isArray(entry)) return null;
  const o = entry as Record<string, unknown>;
  if (o.type === "http") {
    const url = o.url;
    if (typeof url !== "string" || !url.trim()) return null;
    const headers: Record<string, string> = {};
    if (typeof o.headers === "object" && o.headers !== null && !Array.isArray(o.headers)) {
      for (const [k, v] of Object.entries(o.headers)) {
        if (typeof v === "string") headers[k] = v;
      }
    }
    return { type: "http", url: url.trim(), ...(Object.keys(headers).length > 0 && { headers }) };
  }
  const command = o.command;
  if (typeof command !== "string" || !command.trim()) return null;
  const args: string[] = [];
  if (Array.isArray(o.args)) {
    for (const a of o.args) {
      if (typeof a === "string") args.push(a);
    }
  }
  const env: Record<string, string> = {};
  if (typeof o.env === "object" && o.env !== null && !Array.isArray(o.env)) {
    for (const [k, v] of Object.entries(o.env)) {
      if (typeof v === "string") env[k] = v;
    }
  }
  return {
    ...(o.type === "stdio" && { type: "stdio" as const }),
    command: command.trim(),
    ...(args.length > 0 && { args }),
    ...(Object.keys(env).length > 0 && { env }),
  };
}

/**
 * 从指定路径读取 .mcp.json 或任意含 mcpServers 的 JSON 文件，解析并与 Claude Code 格式兼容。
 */
export async function readMcpJsonFromPath(
  filePath: string
): Promise<Record<string, McpServerConfig> | null> {
  if (!existsSync(filePath)) return null;
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    const servers = obj.mcpServers;
    if (typeof servers !== "object" || servers === null || Array.isArray(servers)) return null;
    const result: Record<string, McpServerConfig> = {};
    for (const [name, entry] of Object.entries(servers)) {
      const c = parseOneMcpServerConfig(entry);
      if (c) result[name] = c;
    }
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

/**
 * 读取项目根目录 .mcp.json（若存在），解析 mcpServers 并与 Claude Code 格式兼容。
 */
export async function readProjectMcpJson(cwd: string): Promise<Record<string, McpServerConfig> | null> {
  return readMcpJsonFromPath(join(cwd, ".mcp.json"));
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
    globalSkillDirs: getDefaultGlobalSkillDirs(),
    skipGlobalSkills: false,
    autoMemoryEnabled: true,
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
    if (fileConfig.globalSkillDirs != null)
      merged.globalSkillDirs = fileConfig.globalSkillDirs.map(resolveTilde);
    if (fileConfig.skipGlobalSkills != null) merged.skipGlobalSkills = fileConfig.skipGlobalSkills;
    if (fileConfig.pluginDirs != null) merged.pluginDirs = [...fileConfig.pluginDirs];
    merged.policy = mergePolicy(merged.policy, fileConfig.policy);
    if (fileConfig.mcpServers != null && Object.keys(fileConfig.mcpServers).length > 0) {
      merged.mcpServers = {};
      for (const [name, cfg] of Object.entries(fileConfig.mcpServers)) {
        merged.mcpServers[name] = expandMcpServerConfig(cfg);
      }
    }
    if (fileConfig.autoMemoryEnabled != null) merged.autoMemoryEnabled = fileConfig.autoMemoryEnabled;
    if (fileConfig.claudeMdExcludes != null) merged.claudeMdExcludes = [...fileConfig.claudeMdExcludes];
    if (fileConfig.memoryPath != null) merged.memoryPath = fileConfig.memoryPath;
  }

  const projectMcp = await readProjectMcpJson(cwd);
  if (projectMcp != null) {
    merged.mcpServers = { ...(merged.mcpServers ?? {}) };
    for (const [name, cfg] of Object.entries(projectMcp)) {
      merged.mcpServers[name] = expandMcpServerConfig(cfg);
    }
  }

  const envGlobalSkillDirs = process.env.GLOBAL_SKILLS_DIRS?.trim();
  if (envGlobalSkillDirs) {
    const dirs = envGlobalSkillDirs
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(resolveTilde);
    if (dirs.length > 0) merged.globalSkillDirs = dirs;
  }
  const envSkipGlobal = process.env.MINI_AGENT_SKIP_GLOBAL_SKILLS?.trim();
  if (envSkipGlobal && envSkipGlobal !== "0" && envSkipGlobal.toLowerCase() !== "false") {
    merged.skipGlobalSkills = true;
  }
  const envDisableAutoMemory = process.env.MINI_AGENT_DISABLE_AUTO_MEMORY?.trim();
  if (envDisableAutoMemory && envDisableAutoMemory !== "0" && envDisableAutoMemory.toLowerCase() !== "false") {
    merged.autoMemoryEnabled = false;
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
  if (cli.pluginDirs != null) {
    merged.pluginDirs = [...(merged.pluginDirs ?? []), ...cli.pluginDirs];
  }
  if (cli.enabledMcpServerNames != null) {
    merged.enabledMcpServerNames = cli.enabledMcpServerNames;
  } else if (merged.mcpServers != null && Object.keys(merged.mcpServers).length > 0) {
    merged.enabledMcpServerNames = Object.keys(merged.mcpServers);
  }
  if (cli.autoMemoryEnabled != null) merged.autoMemoryEnabled = cli.autoMemoryEnabled;
  if (cli.claudeMdExcludes != null) {
    merged.claudeMdExcludes = [...(merged.claudeMdExcludes ?? []), ...cli.claudeMdExcludes];
  }
  if (cli.memoryPath != null) merged.memoryPath = resolveTilde(cli.memoryPath);

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
