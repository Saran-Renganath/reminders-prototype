// npm run eval
// Runs every case through the real model, session by session, carrying open items forward.
// Reports precision (kept items that were expected), recall (expected items that were kept),
// closing accuracy, and how many proposals the span check threw out.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalize } from "../src/ground.js";
import { runOpenLoops } from "../src/pipeline.js";
import { AnthropicProvider } from "../src/provider.js";
import type { OpenLoop } from "../src/types.js";
import { CASES } from "./cases.js";

const provider = new AnthropicProvider();
const dir = join(import.meta.dirname, "notes");

let tp = 0, fp = 0, fn = 0, closeHit = 0, closeMiss = 0, wrongClose = 0, groundingDrops = 0;

for (const c of CASES) {
  console.log(`\n${c.client}`);
  let open: OpenLoop[] = [];
  for (const s of c.sessions) {
    const note = readFileSync(join(dir, s.file), "utf8");
    const before = new Set(open.map((l) => l.id));
    const res = await runOpenLoops({ note, sessionId: s.file, sessionDate: s.date, previous: open, provider });

    const fresh = res.loops.filter((l) => !before.has(l.id));
    const closedNow = res.loops.filter((l) => before.has(l.id) && l.status === "done");
    groundingDrops += res.rejected.filter((r) => /quote|short/.test(r.reason)).length;

    // New items
    const unmatched = [...s.expectNew];
    for (const l of fresh) {
      const i = unmatched.findIndex((e) => e.type === l.type && normalize(l.source_span).includes(normalize(e.match)));
      if (i >= 0) { tp++; unmatched.splice(i, 1); console.log(`  ✓ ${l.type.padEnd(16)} ${l.title}`); }
      else { fp++; console.log(`  ✗ extra            ${l.title}  ("${l.source_span}")`); }
    }
    for (const e of unmatched) { fn++; console.log(`  ✗ missed           ${e.type}: ${e.match}`); }

    // Closures
    for (const phrase of s.expectClosed) {
      const hit = closedNow.some((l) => normalize(l.source_span).includes(normalize(phrase)));
      if (hit) { closeHit++; console.log(`  ✓ closed           ${phrase}`); }
      else { closeMiss++; console.log(`  ✗ not closed       ${phrase}`); }
    }
    for (const l of closedNow) {
      if (!s.expectClosed.some((p) => normalize(l.source_span).includes(normalize(p)))) {
        wrongClose++; console.log(`  ✗ closed wrongly   ${l.title}`);
      }
    }
    for (const r of res.rejected) console.log(`  · dropped: ${r.reason}`);
    console.log(`  ${s.file}: ${res.loops.filter((l) => l.status === "open").length} open after this session`);
    open = res.loops.filter((l) => l.status === "open");
  }
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "n/a");
console.log("\n── Results ──────────────────────────");
console.log(`Precision        ${pct(tp, tp + fp)}  (${tp}/${tp + fp})`);
console.log(`Recall           ${pct(tp, tp + fn)}  (${tp}/${tp + fn})`);
console.log(`Correct closes   ${pct(closeHit, closeHit + closeMiss)}  (${closeHit}/${closeHit + closeMiss}), wrong closes: ${wrongClose}`);
console.log(`Span-check drops ${groundingDrops}`);
