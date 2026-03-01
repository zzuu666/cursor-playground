import type {
  AssistantContentBlock,
  ConversationMessage,
} from "../agent/session.js";

export interface StreamCallbacks {
  onText?: (delta: string) => void;
}

export interface ChatProvider {
  name: string;
  complete(messages: ConversationMessage[]): Promise<AssistantContentBlock[]>;
  /**
   * Optional: stream tokens then return full blocks. If not implemented, caller uses complete().
   */
  streamComplete?(
    messages: ConversationMessage[],
    callbacks: StreamCallbacks
  ): Promise<AssistantContentBlock[]>;
}
