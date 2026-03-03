import type { AssistantContentBlock } from "../agent/session.js";
import type { ChatProvider, CompleteOptions } from "./base.js";

export class MockProvider implements ChatProvider {
  name = "mock-provider";

  async complete(
    _messages?: unknown,
    _options?: CompleteOptions
  ): Promise<AssistantContentBlock[]> {
    return [
      {
        type: "text",
        text: "Phase 0 provider is running. In Phase 1, replace this with real MiniMax API calls.",
      },
    ];
  }
}
