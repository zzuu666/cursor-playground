import OpenAI from "openai";
import type {
  AssistantContentBlock,
  ConversationMessage,
  ToolResultBlock,
  ToolUseBlock,
} from "../agent/session.js";
import { retryWithBackoff } from "../infra/retry.js";
import { SYSTEM_PROMPT } from "../prompts/system.js";
import type { ChatProvider } from "./base.js";
import type { ToolInputSchema } from "../tools/types.js";

/** OpenAI 兼容 API 的 tool 定义（name, description, parameters 为 JSON Schema）。 */
export interface OpenAIToolSpec {
  name: string;
  description: string;
  parameters: ToolInputSchema;
}

export interface OpenAICompatibleProviderOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  tools?: OpenAIToolSpec[];
  maxRetries?: number;
  retryDelayMs?: number;
}

const MAX_TOKENS = 4096;

/** 将 session 的 ConversationMessage[] 转为 OpenAI SDK 的 messages 格式 */
function toOpenAIMessages(
  messages: ConversationMessage[]
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        out.push({ role: "user", content: msg.content });
      } else {
        for (const block of msg.content) {
          if (block.type === "text") {
            out.push({ role: "user", content: block.text });
          } else {
            const tr = block as ToolResultBlock;
            out.push({
              role: "tool",
              tool_call_id: tr.tool_use_id,
              content: tr.content,
            });
          }
        }
      }
      continue;
    }

    if (msg.role === "assistant") {
      const textParts: string[] = [];
      const toolCalls: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }> = [];
      for (const block of msg.content) {
        if (block.type === "text") {
          textParts.push(block.text);
        } else if (block.type === "tool_use") {
          const tu = block as ToolUseBlock;
          toolCalls.push({
            id: tu.id,
            type: "function",
            function: {
              name: tu.name,
              arguments: JSON.stringify(tu.input ?? {}),
            },
          });
        }
      }
      const content = textParts.length > 0 ? textParts.join("\n") : null;
      if (toolCalls.length > 0) {
        (out as Array<OpenAI.Chat.ChatCompletionMessageParam>).push({
          role: "assistant",
          content: content ?? "",
          tool_calls: toolCalls,
        });
      } else {
        out.push({ role: "assistant", content: content ?? "" });
      }
    }
  }

  return out;
}

/** 将 OpenAI 返回的 message 转为 AssistantContentBlock[] */
function fromOpenAIMessage(
  content: string | null,
  toolCalls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }>
): AssistantContentBlock[] {
  const out: AssistantContentBlock[] = [];
  if (content != null && content.trim() !== "") {
    out.push({ type: "text", text: content });
  }
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls) {
      if (tc.type === "function" && tc.id != null && tc.function?.name != null) {
        let input: Record<string, unknown> = {};
        try {
          if (typeof tc.function.arguments === "string" && tc.function.arguments.trim()) {
            input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          }
        } catch {
          // 解析失败时保留空对象
        }
        out.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
    }
  }
  return out;
}

export class OpenAICompatibleProvider implements ChatProvider {
  readonly name: string;
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly tools: OpenAIToolSpec[];
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(options: OpenAICompatibleProviderOptions & { providerLabel?: string }) {
    this.name = options.providerLabel ?? "openai-compatible";
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL.replace(/\/$/, "") + "/v1",
    });
    this.model = options.model;
    this.tools = options.tools ?? [];
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
  }

  async complete(messages: ConversationMessage[]): Promise<AssistantContentBlock[]> {
    return retryWithBackoff(
      async () => {
        const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
          model: this.model,
          max_tokens: MAX_TOKENS,
          messages: toOpenAIMessages(messages),
        };
        if (this.tools.length > 0) {
          params.tools = this.tools.map((t) => ({
            type: "function" as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          }));
          params.tool_choice = "auto";
        }

        const completion = await this.client.chat.completions.create(params);
        const message = completion.choices?.[0]?.message;
        if (!message) {
          return [];
        }
        return fromOpenAIMessage(
          message.content ?? null,
          message.tool_calls as Array<{
            id?: string;
            type?: string;
            function?: { name?: string; arguments?: string };
          }> | undefined
        );
      },
      { maxRetries: this.maxRetries, retryDelayMs: this.retryDelayMs }
    );
  }
}
