import type { ResolvedConfig } from "../config.js";
import { getMinimaxConfig } from "../config.js";
import { getOpenAICompatibleConfig } from "../config.js";
import type { Tool } from "../tools/types.js";
import type { ChatProvider } from "./base.js";
import { AnthropicProvider } from "./anthropic.js";
import { MockProvider } from "./mock.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";

/** 支持的 LLM Provider 标识 */
export type ProviderId = "minimax" | "openai" | "deepseek" | "mock";

const PROVIDER_IDS: ProviderId[] = ["minimax", "openai", "deepseek", "mock"];

/** 校验并规范化 provider 字符串为 ProviderId，非法时抛出。 */
export function parseProviderId(provider: string): ProviderId {
  const normalized = provider.trim().toLowerCase();
  if (PROVIDER_IDS.includes(normalized as ProviderId)) {
    return normalized as ProviderId;
  }
  throw new Error(
    `Unknown provider "${provider}". Supported: ${PROVIDER_IDS.join(", ")}. Check config or --provider.`
  );
}

/**
 * 根据 provider 标识与配置创建 ChatProvider 实例。
 * @param providerId 已校验的 ProviderId
 * @param resolved 合并后的运行配置
 * @param tools 工具列表（来自 ToolRegistry.list()），将按各 provider 要求转换为 API 格式
 */
export function createProvider(
  providerId: ProviderId,
  resolved: ResolvedConfig,
  tools: Tool[]
): ChatProvider {
  const apiTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
  const openaiTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
  }));
  const retry = {
    maxRetries: resolved.policy.maxRetries,
    retryDelayMs: resolved.policy.retryDelayMs,
  };

  const systemPromptOpt = resolved.systemPrompt != null ? { systemPrompt: resolved.systemPrompt } : {};

  switch (providerId) {
    case "mock":
      return new MockProvider();
    case "minimax": {
      const cfg = getMinimaxConfig(resolved);
      return new AnthropicProvider({
        ...cfg,
        tools: apiTools,
        ...retry,
        ...systemPromptOpt,
      });
    }
    case "openai": {
      const cfg = getOpenAICompatibleConfig("openai", resolved);
      return new OpenAICompatibleProvider({
        ...cfg,
        tools: openaiTools,
        ...retry,
        providerLabel: "openai",
        ...systemPromptOpt,
      });
    }
    case "deepseek": {
      const cfg = getOpenAICompatibleConfig("deepseek", resolved);
      return new OpenAICompatibleProvider({
        ...cfg,
        tools: openaiTools,
        ...retry,
        providerLabel: "deepseek",
        ...systemPromptOpt,
      });
    }
    default: {
      const _: never = providerId;
      throw new Error(`Unsupported provider: ${String(_)}`);
    }
  }
}
