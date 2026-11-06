import { spawnSync } from "node:child_process";
import { ClaudeCodeProvider } from "./claudeCode.js";
import { AnthropicProvider, type Provider } from "./provider.js";
import { RulesProvider } from "./rules.js";

export type ProviderName = "rules" | "claude-code" | "api";

export function hasClaudeCli(): boolean {
  const r = spawnSync(process.env.CLAUDE_BIN ?? "claude", ["--version"], { shell: process.platform === "win32", encoding: "utf8" });
  return r.status === 0;
}

/** "auto" picks: API key if set, else Claude Code if installed, else the offline rules. */
export function resolveProvider(name: string | undefined): ProviderName {
  if (name === "rules" || name === "claude-code" || name === "api") return name;
  if (process.env.ANTHROPIC_API_KEY) return "api";
  if (hasClaudeCli()) return "claude-code";
  return "rules";
}

export function makeProvider(name: ProviderName): Provider {
  if (name === "api") return new AnthropicProvider();
  if (name === "claude-code") return new ClaudeCodeProvider();
  return new RulesProvider();
}

/** Reads --provider=<name> from argv. */
export function providerFromArgs(argv = process.argv): ProviderName {
  const flag = argv.find((a) => a.startsWith("--provider="))?.split("=")[1];
  return resolveProvider(flag);
}
