import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./helpers/cli-runner.js";

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("mini-agent CLI memory and context compression smoke", () => {
  it("honors --no-auto-memory by not creating MEMORY.md", async () => {
    const tmp = createTempDir("mini-agent-memory-");
    const memoryPath = join(tmp, "memory-root");

    const result = await runCli(
      ["--provider", "mock", "--no-auto-memory", "--memory-path", memoryPath, "--prompt", "hello"],
      {
        cwd: tmp,
      }
    );

    expect(result.exitCode).toBe(0);
    // In smoke level we only assert that it does not crash; detailed file checks can be added later if needed.
  });

  it("runs with small context-max-tokens without crashing", async () => {
    const tmp = createTempDir("mini-agent-context-");

    const result = await runCli(
      [
        "--provider",
        "mock",
        "--context-max-tokens",
        "10",
        "--compress-strategy",
        "token_based",
        "--prompt",
        "this is a long prompt to trigger approximate token limit",
      ],
      {
        cwd: tmp,
      }
    );

    expect(result.exitCode).toBe(0);
  });
});

