// npm run eval                         (auto: API key > Claude Code > rules)
// npm run eval -- --provider=rules     (offline, no AI)
// npm run eval -- --provider=claude-code
// Runs every case through the real model, session by session, carrying open items forward.
// Scores the To do card. Reports precision (kept items that were expected), recall (expected items that were kept),
// closing accuracy, and how many proposals the span check threw out.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalize } from "../src/ground.js";
import { runOpenLoops } from "../src/pipeline.js";
import { makeProvider, providerFromArgs } from "../src/providers.js";
import type { OpenLoop } from "../src/types.js";
import { CASES, type ExpectedNew } from "./cases.js";

const typeOk = (e: ExpectedNew, t: string) => (Array.isArray(e.type) ? e.type.includes(t as never) : e.type === t);

const providerName = providerFromArgs();
const provider = makeProvider(providerName);
console.log(`Provider: ${providerName}`);
const dir = join(import.meta.dirname, "notes");

let checkIns = 0, preps = 0, autoTicked = 0;
let tp = 0, fp = 0, fn = 0, closeHit = 0, closeMiss = 0, wrongClose = 0, groundingDrops = 0;

for (const c of CASES) {
  console.log(`\n${c.client}`);
  let open: OpenLoop[] = [];
  for (const s of c.sessions) {
    const note = readFileSync(join(dir, s.file), "utf8");
    const before = new Set(open.map((l) => l.id));
    const res = await runOpenLoops({ note, sessionId: s.file, sessionDate: s.date, previous: open, provider });

    const fresh = res.loops.filter((l) => !before.has(l.id) && l.card === "todo");
    const closedNow = res.loops.filter((l) => before.has(l.id) && l.status === "done" && l.card === "todo");
    const other = res.loops.filter((l) => l.card !== "todo");
    checkIns += other.filter((l) => !before.has(l.id) && l.card === "check_in").length;
    preps += other.filter((l) => !before.has(l.id) && l.card === "prep").length;
    autoTicked += other.filter((l) => before.has(l.id) && l.status === "done").length;
    groundingDrops += res.rejected.filter((r) => /quote|short/.test(r.reason)).length;

    // New items
    const unmatched = [...s.expectNew];
    for (const l of fresh) {
      const i = unmatched.findIndex((e) => typeOk(e, l.type) && normalize(l.source_span).includes(normalize(e.match)));
      if (i >= 0) { tp++; unmatched.splice(i, 1); console.log(`  ✓ ${l.type.padEnd(16)} ${l.title}`); }
      else { fp++; console.log(`  ✗ extra            ${l.title}  ("${l.source_span}")`); }
    }
    for (const e of unmatched) { fn++; console.log(`  ✗ missed           ${[e.type].flat().join("/")}: ${e.match}`); }

    // Closures: each expectation must be met by a distinct closed item of the same type.
    const closedLeft = [...closedNow];
    for (const e of s.expectClosed) {
      const i = closedLeft.findIndex((l) => typeOk(e, l.type) && normalize(l.source_span).includes(normalize(e.match)));
      if (i >= 0) { closeHit++; closedLeft.splice(i, 1); console.log(`  ✓ closed           ${[e.type].flat().join("/")}: ${e.match}`); }
      else { closeMiss++; console.log(`  ✗ not closed       ${[e.type].flat().join("/")}: ${e.match}`); }
    }
    for (const l of closedLeft) { wrongClose++; console.log(`  ✗ closed wrongly   ${l.title}`); }
    for (const r of res.rejected) console.log(`  · dropped: ${r.reason}`);
    console.log(`  ${s.file} "${res.title}": ${res.loops.filter((l) => l.status === "open" && l.card === "todo").length} to-dos open`);
    open = res.loops.filter((l) => l.status === "open");
  }
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "n/a");
console.log(`\n── Results (${providerName}) ─────────────────`);
console.log(`Precision        ${pct(tp, tp + fp)}  (${tp}/${tp + fp})`);
console.log(`Recall           ${pct(tp, tp + fn)}  (${tp}/${tp + fn})`);
console.log(`Correct closes   ${pct(closeHit, closeHit + closeMiss)}  (${closeHit}/${closeHit + closeMiss}), wrong closes: ${wrongClose}`);
console.log(`Span-check drops ${groundingDrops}`);
console.log(`Not scored: ${checkIns} check-ins, ${preps} prep topics opened, ${autoTicked} auto-ticked`);
