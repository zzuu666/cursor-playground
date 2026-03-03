import type { Tool } from "./types.js";

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  /** 返回仅只读工具列表，供 Plan 模式使用。 */
  listReadOnly(): Tool[] {
    return this.list().filter((t) => t.readOnly === true);
  }
}
