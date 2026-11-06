import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_NEW_PER_SESSION, isDuplicate, runOpenLoops } from "../src/pipeline.js";
import { FixedProvider } from "../src/provider.js";
import type { Candidate } from "../src/types.js";

const notes = join(import.meta.dirname, "..", "evals", "notes");
const s3 = readFileSync(join(notes, "jordan-s3.txt"), "utf8");
const s4 = readFileSync(join(notes, "jordan-s4.txt"), "utf8");
const s5 = readFileSync(join(notes, "jordan-s5.txt"), "utf8");

const letter: Candidate = {
  type: "letter_or_form",
  title: "Send progress letter to family doctor",
  source_span: "family doctor requested a short progress letter",
  third_party: "family doctor",
  due: null,
};
const billing: Candidate = {
  type: "billing_or_admin",
  title: "Answer extended health billing question",
  source_span: "asked about billing sessions to extended health insurance",
  third_party: null,
  due: null,
};
const referral: Candidate = {
  type: "checkpoint",
  title: "Decide on sleep clinic referral",
  source_span: "Consider referral to sleep clinic if no improvement in 3 weeks",
  third_party: null,
  due: "2026-11-27",
};
const madeUp: Candidate = {
  type: "letter_or_form",
  title: "Thank the referring doctor",
  source_span: "Thank you for referring Jordan",
  third_party: "family doctor",
  due: null,
};

describe("runOpenLoops", () => {
  it("keeps grounded items and drops the invented one", async () => {
    const res = await runOpenLoops({
      note: s3, sessionId: "s3", sessionDate: "2026-11-06",
      provider: new FixedProvider({ candidates: [letter, billing, referral, madeUp], updates: [] }),
    });
    expect(res.loops.map((l) => l.title)).toEqual([letter.title, billing.title, referral.title]);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0].reason).toBe("quote not found in the note");
  });

  it("flags consent when a third party is involved", async () => {
    const res = await runOpenLoops({
      note: s3, sessionId: "s3", sessionDate: "2026-11-06",
      provider: new FixedProvider({ candidates: [letter, billing], updates: [] }),
    });
    expect(res.loops.find((l) => l.type === "letter_or_form")?.consent_required).toBe(true);
    expect(res.loops.find((l) => l.type === "billing_or_admin")?.consent_required).toBe(false);
  });

  it("carries open items into the next session when nothing closes them (the session 4 gap)", async () => {
    const first = await runOpenLoops({
      note: s3, sessionId: "s3", sessionDate: "2026-11-06",
      provider: new FixedProvider({ candidates: [letter, billing, referral], updates: [] }),
    });
    const second = await runOpenLoops({
      note: s4, sessionId: "s4", sessionDate: "2026-11-13", previous: first.loops,
      provider: new FixedProvider({ candidates: [], updates: [] }),
    });
    expect(second.loops.filter((l) => l.status === "open")).toHaveLength(3);
    expect(second.loops[0].history.at(-1)?.event).toBe("carried forward");
  });

  it("closes an item only with a quote from the new note", async () => {
    const first = await runOpenLoops({
      note: s3, sessionId: "s3", sessionDate: "2026-11-06",
      provider: new FixedProvider({ candidates: [letter, billing], updates: [] }),
    });
    const [l, b] = first.loops;
    const next = await runOpenLoops({
      note: s5, sessionId: "s5", sessionDate: "2026-11-20", previous: first.loops,
      provider: new FixedProvider({
        candidates: [],
        updates: [
          { id: l.id, status: "done", evidence_span: "progress letter was sent to the client's family doctor" },
          { id: b.id, status: "done", evidence_span: "the insurer approved all sessions" }, // not in the note
        ],
      }),
    });
    expect(next.loops.find((x) => x.id === l.id)?.status).toBe("done");
    expect(next.loops.find((x) => x.id === b.id)?.status).toBe("open");
    expect(next.rejected[0].reason).toMatch(/kept open/);
  });

  it("drops a repeat of an item that is already open", async () => {
    const first = await runOpenLoops({
      note: s3, sessionId: "s3", sessionDate: "2026-11-06",
      provider: new FixedProvider({ candidates: [letter], updates: [] }),
    });
    const again = await runOpenLoops({
      note: s3, sessionId: "s3b", sessionDate: "2026-11-06", previous: first.loops,
      provider: new FixedProvider({ candidates: [{ ...letter, title: "Write progress letter for family doctor" }], updates: [] }),
    });
    expect(again.loops).toHaveLength(1);
    expect(again.rejected[0].reason).toMatch(/duplicate/);
  });

  it(`caps new items at ${MAX_NEW_PER_SESSION} per session`, async () => {
    const extra: Candidate = { ...billing, type: "checkpoint", title: "Review sleep diary data", source_span: "Keep a sleep diary" };
    const fourth: Candidate = { ...referral, title: "Plan graded sleep hygiene", source_span: "Introduce sleep hygiene strategies" };
    const res = await runOpenLoops({
      note: s3, sessionId: "s3", sessionDate: "2026-11-06",
      provider: new FixedProvider({ candidates: [letter, billing, referral, fourth, extra], updates: [] }),
    });
    expect(res.loops).toHaveLength(MAX_NEW_PER_SESSION);
  });

  it("ignores a malformed due date", async () => {
    const res = await runOpenLoops({
      note: s3, sessionId: "s3", sessionDate: "2026-11-06",
      provider: new FixedProvider({ candidates: [{ ...referral, due: "in three weeks" }], updates: [] }),
    });
    expect(res.loops[0].due).toBeNull();
  });
});

describe("isDuplicate", () => {
  it("matches reworded titles of the same type, not different types", () => {
    expect(isDuplicate(letter, { type: "letter_or_form", title: "Write the family doctor progress letter" })).toBe(true);
    expect(isDuplicate(letter, { type: "checkpoint", title: "Send progress letter to family doctor" })).toBe(false);
  });
});
