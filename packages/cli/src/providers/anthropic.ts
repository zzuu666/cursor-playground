import Anthropic from "@anthropic-ai/sdk";
import type { AssistantContentBlock, ConversationMessage } from "../agent/session.js";
import type { ChatProvider } from "./base.js";

export interface AnthropicProviderOptions {
  apiKey: string;
  baseURL: string;
  model: string;
}

export class AnthropicProvider implements ChatProvider {
  readonly name = "anthropic-compatible";
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });
    this.model = options.model;
  }

  async complete(_messages: ConversationMessage[]): Promise<AssistantContentBlock[]> {
    throw new Error(
      "AnthropicProvider is reserved for Phase 1. Use MockProvider in Phase 0."
    );
  }
}
