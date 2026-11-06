import { createHash } from "node:crypto";
import { checkSpan, normalize } from "./ground.js";
import type { Provider } from "./provider.js";
import type { Candidate, ExtractionResult, LoopType, OpenLoop, Rejected } from "./types.js";

/** Alert-fatigue guard: at most this many NEW items per session. */
export const MAX_NEW_PER_SESSION = 3;

const TYPES: LoopType[] = ["letter_or_form", "billing_or_admin", "checkpoint"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function loopId(sessionId: string, c: Pick<Candidate, "type" | "title">): string {
  return createHash("sha256").update(`${sessionId}|${c.type}|${normalize(c.title)}`).digest("hex").slice(0, 12);
}

/** Cheap duplicate test: same type and mostly the same words in the title. */
export function isDuplicate(a: Pick<Candidate, "type" | "title">, b: Pick<Candidate, "type" | "title">): boolean {
  if (a.type !== b.type) return false;
  const words = (s: string) => new Set(normalize(s).split(" ").filter((w) => w.length > 3));
  const A = words(a.title);
  const B = words(b.title);
  if (!A.size || !B.size) return false;
  const shared = [...A].filter((w) => B.has(w)).length;
  return shared / Math.min(A.size, B.size) >= 0.6;
}

export interface RunInput {
  note: string;
  sessionId: string;
  sessionDate: string;
  previous?: OpenLoop[];
  provider: Provider;
  now?: string;
}

/**
 * One pass per note:
 *  1. the provider proposes new items and status updates for carried items
 *  2. every new item must pass the span check against THIS note
 *  3. a carried item can only be closed with a quote from THIS note
 *  4. duplicates of carried items are dropped, new items are capped
 */
export async function runOpenLoops(input: RunInput): Promise<ExtractionResult> {
  const { note, sessionId, sessionDate, provider } = input;
  const now = input.now ?? new Date().toISOString();
  const previous = (input.previous ?? []).filter((l) => l.status === "open");
  const proposal = await provider.propose({ note, sessionDate, previous });
  const rejected: Rejected[] = [];

  // Carried items: stay open unless closed with grounded evidence.
  const carried: OpenLoop[] = previous.map((loop) => {
    const u = proposal.updates.find((x) => x.id === loop.id);
    if (!u || u.status === "still_open") {
      return { ...loop, history: [...loop.history, { at: now, session_id: sessionId, event: "carried forward" }] };
    }
    const check = checkSpan(note, u.evidence_span);
    if (!check.ok) {
      rejected.push({ item: u, reason: `kept open: closing evidence failed (${check.reason})` });
      return { ...loop, history: [...loop.history, { at: now, session_id: sessionId, event: "carried forward" }] };
    }
    return {
      ...loop,
      status: "done",
      history: [...loop.history, { at: now, session_id: sessionId, event: "closed", evidence: u.evidence_span ?? undefined }],
    };
  });

  // New items.
  const fresh: OpenLoop[] = [];
  for (const c of proposal.candidates) {
    if (!TYPES.includes(c.type)) {
      rejected.push({ item: c, reason: `unknown type "${c.type}"` });
      continue;
    }
    const check = checkSpan(note, c.source_span);
    if (!check.ok) {
      rejected.push({ item: c, reason: check.reason });
      continue;
    }
    if ([...previous, ...fresh].some((l) => isDuplicate(l, c))) {
      rejected.push({ item: c, reason: "duplicate of an item already open" });
      continue;
    }
    if (fresh.length >= MAX_NEW_PER_SESSION) {
      rejected.push({ item: c, reason: `over the ${MAX_NEW_PER_SESSION}-per-session cap` });
      continue;
    }
    fresh.push({
      type: c.type,
      title: c.title.trim(),
      source_span: c.source_span.trim(),
      third_party: c.third_party?.trim() || null,
      due: c.due && ISO_DATE.test(c.due) ? c.due : null,
      id: loopId(sessionId, c),
      session_id: sessionId,
      status: "open",
      consent_required: Boolean(c.third_party?.trim()),
      history: [{ at: now, session_id: sessionId, event: "opened" }],
    });
  }

  return { loops: [...carried, ...fresh], rejected };
}
