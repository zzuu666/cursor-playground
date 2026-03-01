/**
 * JSON Schema for tool input (Anthropic-compatible: type "object" + properties + required).
 */
export interface ToolInputSchema {
  type: "object";
  properties?: Record<string, { type: string; description?: string }>;
  required?: string[];
  [k: string]: unknown;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  /** 为 true 时，在 approval 策略为 prompt 时会等待用户批准；never 时直接拒绝。 */
  requiresApproval?: boolean;
  execute(args: Record<string, unknown>): Promise<string>;
}

export interface ToolResult {
  content: string;
  isError: boolean;
}
