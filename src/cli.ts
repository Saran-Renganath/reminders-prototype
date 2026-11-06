// npm run extract -- evals/notes/jordan-s3.txt evals/notes/jordan-s4.txt
// Runs the notes in order as consecutive sessions for one client and prints what's open after each.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { runOpenLoops } from "./pipeline.js";
import { AnthropicProvider } from "./provider.js";
import type { OpenLoop } from "./types.js";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Usage: npm run extract -- <note1.txt> [note2.txt ...]");
  process.exit(1);
}

const provider = new AnthropicProvider();
let open: OpenLoop[] = [];
const start = new Date("2026-11-06");

for (const [i, file] of files.entries()) {
  const date = new Date(start.getTime() + i * 7 * 864e5).toISOString().slice(0, 10);
  const res = await runOpenLoops({ note: readFileSync(file, "utf8"), sessionId: basename(file), sessionDate: date, previous: open, provider });
  console.log(`\n▸ ${basename(file)} (${date})`);
  for (const l of res.loops) {
    const flag = l.status === "done" ? "✓ done " : "○ open ";
    console.log(`  ${flag} ${l.title}${l.due ? `  · due ${l.due}` : ""}${l.consent_required ? "  · consent" : ""}`);
    console.log(`          "${l.source_span}"`);
  }
  for (const r of res.rejected) console.log(`  ✗ dropped: ${r.reason}`);
  open = res.loops.filter((l) => l.status === "open");
}
