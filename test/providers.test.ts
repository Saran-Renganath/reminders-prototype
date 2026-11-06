import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ClaudeCodeProvider, parseClaudeCodeOutput } from "../src/claudeCode.js";
import { runOpenLoops } from "../src/pipeline.js";
import { RulesProvider, sentences } from "../src/rules.js";

const notes = join(import.meta.dirname, "..", "evals", "notes");
const read = (f: string) => readFileSync(join(notes, f), "utf8");

describe("rules provider (offline baseline)", () => {
  it("skips the Client Homework section", () => {
    expect(sentences(read("casey-s1.txt")).some((s) => /20 minutes/.test(s))).toBe(false);
  });

  it("finds the three session 3 items, carries them through session 4, closes two in session 5", async () => {
    const p = new RulesProvider();
    const s3 = await runOpenLoops({ note: read("jordan-s3.txt"), sessionId: "s3", sessionDate: "2026-11-06", provider: p });
    expect(s3.loops.map((l) => l.type).sort()).toEqual(["billing_or_admin", "checkpoint", "letter_or_form"]);
    expect(s3.loops.find((l) => l.type === "checkpoint")?.due).toBe("2026-11-27");

    const s4 = await runOpenLoops({ note: read("jordan-s4.txt"), sessionId: "s4", sessionDate: "2026-11-13", previous: s3.loops, provider: p });
    expect(s4.loops.filter((l) => l.status === "open")).toHaveLength(3);

    const s5 = await runOpenLoops({ note: read("jordan-s5.txt"), sessionId: "s5", sessionDate: "2026-11-20", previous: s4.loops, provider: p });
    expect(s5.loops.filter((l) => l.status === "done").map((l) => l.type).sort()).toEqual(["billing_or_admin", "letter_or_form"]);
    expect(s5.loops.find((l) => l.type === "checkpoint")?.status).toBe("open");
  });

  it("produces nothing for a note with no admin follow-ups", async () => {
    const r = await runOpenLoops({ note: read("casey-s1.txt"), sessionId: "c1", sessionDate: "2026-11-04", provider: new RulesProvider() });
    expect(r.loops).toHaveLength(0);
  });
});

describe("Claude Code provider", () => {
  it("parses structured output from the CLI envelope", () => {
    const p = parseClaudeCodeOutput(JSON.stringify({ is_error: false, structured_output: { candidates: [{ type: "checkpoint" }], updates: [] } }));
    expect(p.candidates).toHaveLength(1);
  });

  it("falls back to JSON inside the text result", () => {
    const p = parseClaudeCodeOutput(JSON.stringify({ is_error: false, result: 'Here you go:\n{"candidates":[],"updates":[]}' }));
    expect(p).toEqual({ candidates: [], updates: [] });
  });

  it("turns a sign-in error into a clear message", () => {
    expect(() => parseClaudeCodeOutput(JSON.stringify({ is_error: true, result: "Authentication error" }))).toThrow(/sign in/);
  });

  it.skipIf(process.platform === "win32")("sends the note on stdin and reads the reply (stub CLI)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-"));
    const stub = join(dir, "claude");
    // The stub echoes back a proposal quoting whatever note arrived on stdin.
    writeFileSync(stub, `#!/usr/bin/env node
let input = ""; process.stdin.on("data", d => input += d).on("end", () => {
  const ok = input.includes("family doctor requested a short progress letter");
  process.stdout.write(JSON.stringify({ is_error: false, structured_output: { candidates: ok ? [{ type: "letter_or_form", title: "Send progress letter", source_span: "family doctor requested a short progress letter", third_party: "family doctor", due: null }] : [], updates: [] } }));
});`);
    chmodSync(stub, 0o755);
    const r = await runOpenLoops({ note: read("jordan-s3.txt"), sessionId: "s3", sessionDate: "2026-11-06", provider: new ClaudeCodeProvider({ bin: stub }) });
    expect(r.loops).toHaveLength(1);
    expect(r.loops[0].consent_required).toBe(true);
  });
});
