import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./helpers/cli-runner.js";

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return dir;
}

describe("mini-agent CLI approval / skill / plugin smoke", () => {
  it("runs in dry-run mode and lists tools and skills", async () => {
    const tmp = createTempDir("mini-agent-skill-");
    const skillPath = join(tmp, "SKILL.md");
    writeFileSync(skillPath, "# Test Skill\\nThis is a test skill content.");

    const result = await runCli(
      ["--provider", "mock", "--dry-run", "--skill", skillPath],
      {
        env: {
          ...process.env,
        },
        cwd: tmp,
      }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("[dry-run] prompt:");
    expect(result.stderr).toContain("tools:");
    expect(result.stderr).toContain("skills:");
    expect(result.stderr).toContain("SKILL.md");
  });

  it("loads plugin skills in dry-run mode", async () => {
    const tmp = createTempDir("mini-agent-plugin-");
    const pluginRoot = join(tmp, "my-plugin");
    const manifestDir = join(pluginRoot, ".claude-plugin");
    const skillsDir = join(pluginRoot, "skills", "hello");

    mkdirSync(manifestDir, { recursive: true });
    mkdirSync(skillsDir, { recursive: true });

    const manifest = {
      name: "my-plugin",
      description: "test plugin",
    };
    writeFileSync(join(manifestDir, "plugin.json"), JSON.stringify(manifest), "utf-8");
    writeFileSync(join(skillsDir, "SKILL.md"), "# Hello Skill\\nFrom plugin.", "utf-8");

    const result = await runCli(
      ["--provider", "mock", "--dry-run", "--plugin-dir", pluginRoot],
      {
        cwd: tmp,
      }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("[dry-run] plugins:");
    expect(result.stderr).toContain("my-plugin");
  });
});

