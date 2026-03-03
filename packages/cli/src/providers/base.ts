import type {
  AssistantContentBlock,
  ConversationMessage,
} from "../agent/session.js";
import type { Tool } from "../tools/types.js";

export interface StreamCallbacks {
  onText?: (delta: string) => void;
}

export interface CompleteOptions {
  /** Override tools for this request (e.g. read-only only in plan mode). */
  tools?: Tool[];
  /** Optional suffix appended to system prompt (e.g. Plan mode instructions). */
  systemPromptSuffix?: string;
}

export interface ChatProvider {
  name: string;
  complete(
    messages: ConversationMessage[],
    options?: CompleteOptions
  ): Promise<AssistantContentBlock[]>;
  /**
   * Optional: stream tokens then return full blocks. If not implemented, caller uses complete().
   */
  streamComplete?(
    messages: ConversationMessage[],
    callbacks: StreamCallbacks,
    options?: CompleteOptions
  ): Promise<AssistantContentBlock[]>;
}
