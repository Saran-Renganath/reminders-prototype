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
    expect(s3.loops.filter((l) => l.card === "todo").map((l) => l.type).sort()).toEqual(["billing_or_admin", "checkpoint", "letter_or_form"]);
    // The sleep clinic decision is a to-do; it must not also appear under Prep.
    expect(s3.loops.filter((l) => /sleep clinic/i.test(l.source_span))).toHaveLength(1);
    expect(s3.loops.find((l) => l.type === "checkpoint")?.due).toBe("2026-11-27");

    const s4 = await runOpenLoops({ note: read("jordan-s4.txt"), sessionId: "s4", sessionDate: "2026-11-13", previous: s3.loops, provider: p });
    expect(s4.loops.filter((l) => l.status === "open" && l.card === "todo")).toHaveLength(3);
    // Homework from session 3 was reviewed in session 4, so it auto-ticks.
    expect(s4.loops.filter((l) => l.card === "check_in" && l.status === "done").length).toBeGreaterThan(0);

    const s5 = await runOpenLoops({ note: read("jordan-s5.txt"), sessionId: "s5", sessionDate: "2026-11-20", previous: s4.loops, provider: p });
    expect(s5.loops.filter((l) => l.status === "done" && l.card === "todo").map((l) => l.type).sort()).toEqual(["billing_or_admin", "letter_or_form"]);
    expect(s5.loops.find((l) => l.type === "checkpoint")?.status).toBe("open");
  });

  it("produces no to-dos for a note where the therapist owes nothing", async () => {
    const r = await runOpenLoops({ note: read("casey-s1.txt"), sessionId: "c1", sessionDate: "2026-11-04", provider: new RulesProvider() });
    expect(r.loops.filter((l) => l.card === "todo")).toHaveLength(0);
    expect(r.loops.filter((l) => l.card === "check_in").length).toBeGreaterThan(0);
  });

  it("handles both Maya traps: vague paperwork closes nothing, drafted is not sent", async () => {
    const p = new RulesProvider();
    const m1 = await runOpenLoops({ note: read("maya-s1.txt"), sessionId: "m1", sessionDate: "2026-11-06", provider: p });
    const m2 = await runOpenLoops({ note: read("maya-s2.txt"), sessionId: "m2", sessionDate: "2026-11-13", previous: m1.loops, provider: p });
    expect(m2.loops.filter((l) => l.card === "todo" && l.status === "done")).toHaveLength(0);
    const m3 = await runOpenLoops({ note: read("maya-s3.txt"), sessionId: "m3", sessionDate: "2026-11-20", previous: m2.loops, provider: p });
    const lawyer = m3.loops.find((l) => /lawyer/i.test(l.source_span));
    expect(lawyer?.status).toBe("open");
    expect(m3.loops.find((l) => /superbill/i.test(l.source_span))?.status).toBe("done");
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
