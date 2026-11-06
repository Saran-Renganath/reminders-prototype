import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { itemKey, runReminders } from "../src/pipeline.js";
import type { Proposal, ProposeInput, Provider } from "../src/provider.js";
import { FixedProvider } from "../src/provider.js";
import { RulesProvider } from "../src/rules.js";
import type { Reminder } from "../src/types.js";

const notes = join(import.meta.dirname, "..", "evals", "notes");
const read = (f: string) => readFileSync(join(notes, f), "utf8");

/** Records what the model was asked about, so we can check ticked items are never sent. */
class SpyProvider implements Provider {
  seen: Reminder[][] = [];
  constructor(private inner: Provider) {}
  async propose(input: ProposeInput): Promise<Proposal> {
    this.seen.push(input.previous);
    return this.inner.propose(input);
  }
}

async function runAll(manualDone = new Set<string>(), provider: Provider = new RulesProvider()) {
  const files = ["jordan-s3.txt", "jordan-s4.txt", "jordan-s5.txt"];
  const out = [];
  let open: Reminder[] = [];
  for (const [i, f] of files.entries()) {
    const r = await runReminders({ note: read(f), sessionId: `session-${i + 1}`, sessionDate: `2026-11-${String(6 + i * 7).padStart(2, "0")}`, previous: open, provider, manualDone });
    out.push(r);
    open = r.reminders.filter((x) => x.status === "open");
  }
  return out;
}

describe("ticking an item by hand", () => {
  it("closes it in its own session and it never comes back in later sessions", async () => {
    const before = await runAll();
    const letter = before[0].reminders.find((x) => x.type === "letter_or_form")!;
    const after = await runAll(new Set([itemKey(letter)]));

    const inS3 = after[0].reminders.find((x) => x.id === letter.id)!;
    expect(inS3.status).toBe("done");
    expect(inS3.history.at(-1)?.event).toBe("ticked by therapist");
    expect(after[1].reminders.some((x) => x.id === letter.id)).toBe(false);
    expect(after[2].reminders.some((x) => x.id === letter.id)).toBe(false);
  });

  it("is never sent to the model as an open item again", async () => {
    const first = await runAll();
    const letter = first[0].reminders.find((x) => x.type === "letter_or_form")!;
    const spy = new SpyProvider(new RulesProvider());
    await runAll(new Set([itemKey(letter)]), spy);
    for (const prev of spy.seen) expect(prev.some((x) => x.id === letter.id)).toBe(false);
  });

  it("works for a ticked item that was already carried forward", async () => {
    const first = await runReminders({
      note: read("jordan-s3.txt"), sessionId: "s3", sessionDate: "2026-11-06",
      provider: new FixedProvider({ candidates: [{ type: "client_homework", title: "Keep a sleep diary", source_span: "Keep a sleep diary.", third_party: null, due: null }], updates: [] }),
    });
    const item = first.reminders[0];
    const next = await runReminders({
      note: read("jordan-s4.txt"), sessionId: "s4", sessionDate: "2026-11-13", previous: first.reminders,
      provider: new FixedProvider({ candidates: [], updates: [] }), manualDone: new Set([itemKey(item)]),
    });
    expect(next.reminders).toHaveLength(1);
    expect(next.reminders[0].status).toBe("done");
    expect(next.reminders[0].history.at(-1)?.event).toBe("ticked by therapist");
  });

  it("keys survive a re-run: same type and quote, whatever the casing or spacing", () => {
    const a = itemKey({ type: "client_homework", source_span: "Keep a  sleep diary." });
    const b = itemKey({ type: "client_homework", source_span: "keep a sleep diary" });
    expect(a).toBe(b);
  });
});

describe("session titles", () => {
  it("come from the provider, with a fallback", async () => {
    const r = await runReminders({ note: read("jordan-s3.txt"), sessionId: "s", sessionDate: "2026-11-06", provider: new FixedProvider({ session_title: " Work anxiety and sleep ", candidates: [], updates: [] }) });
    expect(r.title).toBe("Work anxiety and sleep");
    const r2 = await runReminders({ note: "x", sessionId: "s", sessionDate: "2026-11-06", provider: new FixedProvider({ candidates: [], updates: [] }) });
    expect(r2.title).toBe("Session");
  });
});
