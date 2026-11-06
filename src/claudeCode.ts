// Runs extraction through the Claude Code CLI (`claude -p`), which signs in with your
// Claude subscription. No API key needed. Same prompt and JSON schema as the API provider.

import { spawn } from "node:child_process";
import type { Proposal, ProposeInput, Provider } from "./provider.js";
import { SYSTEM, TOOL } from "./provider.js";

export interface ClaudeCodeOptions {
  bin?: string; // path to the claude CLI; tests point this at a stub
  model?: string; // e.g. "haiku", "sonnet"; default lets the CLI choose
  timeoutMs?: number;
}

export class ClaudeCodeProvider implements Provider {
  private bin: string;
  private model?: string;
  private timeoutMs: number;

  constructor(opts: ClaudeCodeOptions = {}) {
    this.bin = opts.bin ?? process.env.CLAUDE_BIN ?? "claude";
    this.model = opts.model ?? process.env.OPEN_LOOPS_CC_MODEL;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  async propose({ note, sessionDate, previous }: ProposeInput): Promise<Proposal> {
    const earlier = previous.length
      ? previous.map((l) => `- id=${l.id} | ${l.type} | ${l.title} | due=${l.due ?? "none"}`).join("\n")
      : "(none)";
    // Everything goes in on stdin, so long text and quotes never hit the shell (matters on Windows).
    const prompt = [
      SYSTEM,
      `Reply with one JSON object matching this schema, and nothing else:\n${JSON.stringify(TOOL.input_schema)}`,
      `Session date: ${sessionDate}`,
      `Items still open from earlier sessions:\n${earlier}`,
      `<note>\n${note}\n</note>`,
    ].join("\n\n");

    const args = ["-p", "--output-format", "json", "--tools", "", "--no-session-persistence", "--strict-mcp-config"];
    // Structured output when the platform makes it easy to pass; the prompt asks for JSON either way.
    if (process.platform !== "win32") args.push("--json-schema", JSON.stringify(TOOL.input_schema));
    if (this.model) args.push("--model", this.model);

    const stdout = await run(this.bin, args, prompt, this.timeoutMs);
    return parseClaudeCodeOutput(stdout);
  }
}

/** Exported for tests. Accepts the CLI's JSON envelope and pulls out the proposal. */
export function parseClaudeCodeOutput(stdout: string): Proposal {
  let env: { is_error?: boolean; result?: string; structured_output?: unknown };
  try {
    env = JSON.parse(stdout);
  } catch {
    throw new Error(`Claude Code returned something that isn't JSON: ${stdout.slice(0, 200)}`);
  }
  if (env.is_error) {
    throw new Error(`Claude Code error: ${env.result ?? "unknown"}. Run \`claude\` once in a terminal to sign in.`);
  }
  let body: unknown = env.structured_output;
  if (!body && env.result) {
    const m = env.result.match(/\{[\s\S]*\}/);
    if (m) body = JSON.parse(m[0]);
  }
  const p = (body ?? {}) as Partial<Proposal>;
  if (!Array.isArray(p.candidates)) throw new Error("Claude Code response had no candidates array.");
  return { candidates: p.candidates, updates: Array.isArray(p.updates) ? p.updates : [] };
}

function run(bin: string, args: string[], input: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const win = process.platform === "win32";
    // On Windows the npm-installed CLI is a .cmd file, which needs a shell; quote every arg ourselves.
    const child = win
      ? spawn([bin, ...args].map((a) => `"${a.replace(/"/g, '\\"')}"`).join(" "), { shell: true, stdio: ["pipe", "pipe", "pipe"] })
      : spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.end(input);
    let out = "";
    let err = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Claude Code timed out after ${timeoutMs / 1000}s`)); }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Couldn't start "${bin}". Install Claude Code: npm install -g @anthropic-ai/claude-code (${e.message})`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (out.trim()) resolve(out);
      else reject(new Error(`Claude Code exited with code ${code}: ${err.slice(0, 300)}`));
    });
  });
}
