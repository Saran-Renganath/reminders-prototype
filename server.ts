// npm run dev  → http://localhost:3000
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runReminders } from "./src/pipeline.js";
import { FixedProvider, type Provider } from "./src/provider.js";
import { hasClaudeCli, makeProvider, resolveProvider, type ProviderName } from "./src/providers.js";
import type { Candidate, Reminder } from "./src/types.js";

try { process.loadEnvFile?.(".env"); } catch { /* no .env, fine */ }

const PORT = Number(process.env.PORT ?? 3000);
const root = import.meta.dirname;
const page = () => readFileSync(join(root, "web", "index.html"));
const note = (f: string) => readFileSync(join(root, "evals", "notes", f), "utf8");

const SAMPLES = [
  { id: "jordan", name: "Jordan (notes Klarify generated)", start: 3, notes: ["jordan-s3.txt", "jordan-s4.txt", "jordan-s5.txt"].map(note) },
  { id: "maya", name: "Maya (dictated, with traps)", start: 1, notes: ["maya-s1.txt", "maya-s2.txt", "maya-s3.txt"].map(note) },
];

// Demo mode: a FIXED proposal (no model call) that includes one invented to-do,
// and a later false "done" claim, so you can watch the span check reject both without any setup.
const DEMO: Candidate[] = [
  { type: "letter_or_form", title: "Send progress letter to family doctor", source_span: "family doctor requested a short progress letter", third_party: "family doctor", due: null },
  { type: "billing_or_admin", title: "Answer extended health billing question", source_span: "asked about billing sessions to extended health insurance", third_party: null, due: null },
  { type: "checkpoint", title: "Decide on sleep clinic referral", source_span: "Consider referral to sleep clinic if no improvement in 3 weeks", third_party: null, due: "2026-11-27" },
  { type: "letter_or_form", title: "Thank the referring doctor", source_span: "Thank you for referring Jordan", third_party: "family doctor", due: null },
  { type: "client_homework", title: "Thought record twice this week", source_span: "Complete a thought record twice this week", third_party: null, due: null },
  { type: "client_homework", title: "Keep a sleep diary", source_span: "Keep a sleep diary", third_party: null, due: null },
  { type: "next_topic", title: "Review thought records", source_span: "Review thought records completed during the week", third_party: null, due: null },
  { type: "next_topic", title: "Introduce sleep hygiene", source_span: "Introduce sleep hygiene strategies", third_party: null, due: null },
];

function demoProvider(i: number, open: Reminder[]): Provider {
  const id = (pred: (l: Reminder) => boolean) => open.find(pred)?.id ?? "";
  if (i === 0) return new FixedProvider({ session_title: "Work anxiety and sleep", candidates: DEMO, updates: [] });
  if (i === 1) {
    return new FixedProvider({
      session_title: "Homework review and sleep hygiene",
      candidates: [],
      updates: [
        { id: id((l) => /sleep diary/i.test(l.title)), status: "done", evidence_span: "kept the sleep diary for five nights" },
        { id: id((l) => /thought record/i.test(l.title)), status: "done", evidence_span: "The client completed one thought record instead of the assigned two" },
        { id: id((l) => /sleep hygiene/i.test(l.title)), status: "done", evidence_span: "The session introduced sleep hygiene strategies" },
      ],
    });
  }
  return new FixedProvider({
    session_title: "Progress and admin follow-ups",
    candidates: [],
    updates: [
      { id: id((l) => l.type === "letter_or_form"), status: "done", evidence_span: "progress letter was sent to the client's family doctor" },
      { id: id((l) => l.type === "billing_or_admin"), status: "done", evidence_span: "the insurer approved all sessions" }, // not in the note: must be rejected
    ],
  });
}

createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page());
      return;
    }
    if (req.method === "GET" && req.url === "/api/samples") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
        samples: SAMPLES,
        available: { rules: true, "claude-code": hasClaudeCli(), api: Boolean(process.env.ANTHROPIC_API_KEY) },
        default: resolveProvider(undefined),
      }));
      return;
    }
    if (req.method === "POST" && req.url === "/api/run") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { notes, demo, provider: chosen, manualDone = [] } = JSON.parse(body) as {
        notes: string[]; demo?: boolean; provider?: ProviderName; manualDone?: string[];
      };
      const name = resolveProvider(chosen);
      const ticks = new Set(manualDone);

      const sessions = [];
      let open: Reminder[] = [];
      for (const [i, text] of notes.entries()) {
        const date = new Date(Date.UTC(2026, 10, 6 + i * 7)).toISOString().slice(0, 10);
        const provider: Provider = demo ? demoProvider(i, open) : makeProvider(name);
        const t0 = Date.now();
        const result = await runReminders({ note: text, sessionId: `session-${i}`, sessionDate: date, previous: open, provider, manualDone: ticks });
        sessions.push({ date, ms: Date.now() - t0, ...result });
        open = result.reminders.filter((l) => l.status === "open");
      }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ sessions, provider: demo ? "demo" : name }));
      return;
    }
    res.writeHead(404).end("Not found");
  } catch (err) {
    res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: (err as Error).message }));
  }
}).listen(PORT, () => console.log(`Reminders prototype → http://localhost:${PORT}`));
