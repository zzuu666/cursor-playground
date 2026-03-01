/**
 * 将 base prompt 与各 Skill 片段拼接，每个 skill 前加 [Skill: path] 来源标记。
 */
export function buildSystemPrompt(
  skillEntries: { path: string; content: string }[],
  basePrompt: string
): string {
  if (skillEntries.length === 0) return basePrompt;
  const parts = [basePrompt];
  for (const { path, content } of skillEntries) {
    parts.push(`[Skill: ${path}]\n${content}`);
  }
  return parts.join("\n\n");
}
