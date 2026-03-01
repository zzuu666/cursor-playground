import Anthropic from "@anthropic-ai/sdk";
import type {
  AssistantContentBlock,
  ConversationMessage,
  ToolResultBlock,
  ToolUseBlock,
} from "../agent/session.js";
import { retryWithBackoff } from "../infra/retry.js";
import { SYSTEM_PROMPT } from "../prompts/system.js";
import type { ChatProvider, StreamCallbacks } from "./base.js";
import type { ToolInputSchema } from "../tools/types.js";

export interface AnthropicToolSpec {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
}

export interface AnthropicProviderOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  tools?: AnthropicToolSpec[];
  maxRetries?: number;
  retryDelayMs?: number;
}

const MAX_TOKENS = 4096;

type ApiMessage =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

function toAnthropicMessages(
  messages: ConversationMessage[]
): Array<{ role: "user" | "assistant"; content: string | ApiMessage[] }> {
  const out: Array<{ role: "user" | "assistant"; content: string | ApiMessage[] }> = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        out.push({ role: "user", content: msg.content });
      } else {
        const blocks: ApiMessage[] = msg.content.map((b) => {
          if (b.type === "text") return { type: "text", text: b.text };
          const tr = b as ToolResultBlock;
          const block: ApiMessage = {
            type: "tool_result",
            tool_use_id: tr.tool_use_id,
            content: tr.content,
          };
          if (tr.is_error) block.is_error = true;
          return block;
        });
        out.push({ role: "user", content: blocks });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const blocks: ApiMessage[] = msg.content.map((b) => {
        if (b.type === "text") return { type: "text", text: b.text };
        if (b.type === "thinking")
          return { type: "thinking", thinking: b.thinking, signature: "" };
        const tu = b as ToolUseBlock;
        return { type: "tool_use", id: tu.id, name: tu.name, input: tu.input };
      });
      out.push({ role: "assistant", content: blocks });
    }
  }

  return out;
}

function fromAnthropicContent(
  content: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }>
): AssistantContentBlock[] {
  const out: AssistantContentBlock[] = [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      out.push({ type: "text", text: block.text });
    } else if (block.type === "thinking" && typeof block.thinking === "string") {
      out.push({ type: "thinking", thinking: block.thinking });
    } else if (
      block.type === "tool_use" &&
      block.id != null &&
      block.name != null
    ) {
      out.push({
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: (block.input as Record<string, unknown>) ?? {},
      });
    }
  }
  return out;
}

export class AnthropicProvider implements ChatProvider {
  readonly name = "anthropic-compatible";
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly tools: AnthropicToolSpec[];
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });
    this.model = options.model;
    this.tools = options.tools ?? [];
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
  }

  async complete(
    messages: ConversationMessage[]
  ): Promise<AssistantContentBlock[]> {
    return retryWithBackoff(
      async () => {
        const anthropicMessages = toAnthropicMessages(messages);
        const base = {
          model: this.model as "claude-3-5-sonnet-20241022",
          max_tokens: MAX_TOKENS,
          system: SYSTEM_PROMPT,
          messages: anthropicMessages as Parameters<Anthropic["messages"]["create"]>[0]["messages"],
        };
        type CreateParams = Parameters<Anthropic["messages"]["create"]>[0];
        const createBody: CreateParams =
          this.tools.length > 0 ? { ...base, tools: this.tools as NonNullable<CreateParams["tools"]> } : base;
        const response = await this.client.messages.create(createBody);

        const content = (response as { content?: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }> }).content;
        if (Array.isArray(content)) {
          return fromAnthropicContent(content);
        }
        return [];
      },
      { maxRetries: this.maxRetries, retryDelayMs: this.retryDelayMs }
    );
  }

  async streamComplete(
    messages: ConversationMessage[],
    callbacks: StreamCallbacks
  ): Promise<AssistantContentBlock[]> {
    return retryWithBackoff(
      async () => {
        const anthropicMessages = toAnthropicMessages(messages);
        const base = {
          model: this.model as "claude-3-5-sonnet-20241022",
          max_tokens: MAX_TOKENS,
          system: SYSTEM_PROMPT,
          messages: anthropicMessages as Parameters<Anthropic["messages"]["stream"]>[0]["messages"],
        };
        type StreamParams = Parameters<Anthropic["messages"]["stream"]>[0];
        const streamBody: StreamParams =
          this.tools.length > 0 ? { ...base, tools: this.tools as NonNullable<StreamParams["tools"]> } : base;
        const stream = this.client.messages.stream(streamBody);
        if (callbacks.onText) {
          stream.on("text", (delta: string) => {
            callbacks.onText?.(delta);
          });
        }
        const final = await stream.finalMessage();
        const content = (final as { content?: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }> }).content;
        if (Array.isArray(content)) {
          return fromAnthropicContent(content);
        }
        return [];
      },
      { maxRetries: this.maxRetries, retryDelayMs: this.retryDelayMs }
    );
  }
}
