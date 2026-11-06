// npm run dev  → http://localhost:3000
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runOpenLoops } from "./src/pipeline.js";
import { AnthropicProvider, FixedProvider, type Provider } from "./src/provider.js";
import type { Candidate, OpenLoop } from "./src/types.js";

try { process.loadEnvFile?.(".env"); } catch { /* no .env, fine */ }

const PORT = Number(process.env.PORT ?? 3000);
const page = () => readFileSync(join(import.meta.dirname, "web", "index.html"));
const samples = ["jordan-s3.txt", "jordan-s4.txt", "jordan-s5.txt"].map((f) =>
  readFileSync(join(import.meta.dirname, "evals", "notes", f), "utf8"),
);

// Demo mode: a FIXED proposal (no model call) that includes one invented item,
// so you can watch the span check throw it out without an API key.
const DEMO: Candidate[] = [
  { type: "letter_or_form", title: "Send progress letter to family doctor", source_span: "family doctor requested a short progress letter", third_party: "family doctor", due: null },
  { type: "billing_or_admin", title: "Answer extended health billing question", source_span: "asked about billing sessions to extended health insurance", third_party: null, due: null },
  { type: "checkpoint", title: "Decide on sleep clinic referral", source_span: "Consider referral to sleep clinic if no improvement in 3 weeks", third_party: null, due: "2026-11-27" },
  { type: "letter_or_form", title: "Thank the referring doctor", source_span: "Thank you for referring Jordan", third_party: "family doctor", due: null },
];

// Session 3 proposes DEMO; session 4 proposes nothing; session 5 claims the letter and billing were handled.
// One closing claim quotes the note, the other doesn't, so only one should close.
function demoProvider(i: number, open: OpenLoop[]): Provider {
  if (i === 0) return new FixedProvider({ candidates: DEMO, updates: [] });
  if (i === 2) {
    const id = (t: string) => open.find((l) => l.type === t)?.id ?? "";
    return new FixedProvider({
      candidates: [],
      updates: [
        { id: id("letter_or_form"), status: "done", evidence_span: "progress letter was sent to the client's family doctor" },
        { id: id("billing_or_admin"), status: "done", evidence_span: "insurer approved all sessions" },
      ],
    });
  }
  return new FixedProvider({ candidates: [], updates: [] });
}

createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page());
      return;
    }
    if (req.method === "GET" && req.url === "/api/samples") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ samples, hasKey: Boolean(process.env.ANTHROPIC_API_KEY) }));
      return;
    }
    if (req.method === "POST" && req.url === "/api/run") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { notes, demo } = JSON.parse(body) as { notes: string[]; demo?: boolean };

      const sessions = [];
      let open: OpenLoop[] = [];
      for (const [i, note] of notes.entries()) {
        const date = new Date(Date.UTC(2026, 10, 6 + i * 7)).toISOString().slice(0, 10);
        const provider: Provider = demo ? demoProvider(i, open) : new AnthropicProvider();
        const t0 = Date.now();
        const result = await runOpenLoops({ note, sessionId: `session-${i + 1}`, sessionDate: date, previous: open, provider });
        sessions.push({ date, ms: Date.now() - t0, ...result });
        open = result.loops.filter((l) => l.status === "open");
      }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ sessions }));
      return;
    }
    res.writeHead(404).end("Not found");
  } catch (err) {
    res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: (err as Error).message }));
  }
}).listen(PORT, () => console.log(`Open Loops prototype → http://localhost:${PORT}`));
