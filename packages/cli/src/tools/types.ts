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
  execute(args: Record<string, unknown>): Promise<string>;
}

export interface ToolResult {
  content: string;
  isError: boolean;
}
