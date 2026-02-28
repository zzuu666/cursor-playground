import type {
  AssistantContentBlock,
  ConversationMessage,
} from "../agent/session.js";

export interface ChatProvider {
  name: string;
  complete(messages: ConversationMessage[]): Promise<AssistantContentBlock[]>;
}
