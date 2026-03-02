import { describe, it, expect } from "vitest";
import { runCli } from "./helpers/cli-runner.js";

describe("mini-agent CLI basic smoke", () => {
  it("runs with --provider mock and --prompt and exits with code 0", async () => {
    const result = await runCli(["--provider", "mock", "--prompt", "hello"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("mini-agent config error");
    expect(result.stdout).toContain("Phase 0 provider is running");
  });

  it("reads prompt from STDIN when no --prompt is provided", async () => {
    const result = await runCli(["--provider", "mock"], {
      stdin: "hello from stdin",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("mini-agent config error");
    expect(result.stdout).toContain("Phase 0 provider is running");
  });

  it("prints config error and non-zero exit code when config path is invalid", async () => {
    const result = await runCli(["--config", "non-existent-config.json", "--prompt", "hello"], {
      env: {
        ...process.env,
        // Avoid real network calls in case provider is not mock by default
        MINI_AGENT_PROVIDER: "mock",
      },
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("mini-agent config error");
  });
});

