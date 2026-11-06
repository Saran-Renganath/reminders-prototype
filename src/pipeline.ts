import { createHash } from "node:crypto";
import { checkSpan, normalize } from "./ground.js";
import type { Provider } from "./provider.js";
import { ITEM_TYPES, cardOf, type Candidate, type Card, type Rejected, type Reminder, type SessionResult } from "./types.js";

/** Alert-fatigue guard: at most this many NEW items per card per session. */
export const CAPS: Record<Card, number> = { todo: 3, check_in: 5, prep: 5 };
/** Kept for older imports. */
export const MAX_NEW_PER_SESSION = CAPS.todo;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Stable across runs: same type + same quote = same item. Used for the therapist's own ticks. */
export function itemKey(c: Pick<Candidate, "type" | "source_span">): string {
  return `${c.type}|${normalize(c.source_span)}`;
}

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
  previous?: Reminder[];
  provider: Provider;
  /** Keys (see itemKey) of items the therapist ticked by hand. They close at once and are never carried. */
  manualDone?: Set<string>;
  now?: string;
}

/**
 * One pass per note:
 *  1. items the therapist ticked by hand are closed and left out of the model call
 *  2. the provider proposes new items and status updates for carried items
 *  3. every new item must pass the span check against THIS note
 *  4. a carried item can only be closed with a quote from THIS note
 *  5. duplicates of carried items are dropped, new items are capped per card
 */
export async function runReminders(input: RunInput): Promise<SessionResult> {
  const { note, sessionId, sessionDate, provider } = input;
  const now = input.now ?? new Date().toISOString();
  const manual = input.manualDone ?? new Set<string>();
  const rejected: Rejected[] = [];

  const stillOpen = (input.previous ?? []).filter((l) => l.status === "open");
  const ticked = stillOpen.filter((l) => manual.has(itemKey(l)));
  const previous = stillOpen.filter((l) => !manual.has(itemKey(l)));

  const proposal = await provider.propose({ note, sessionDate, previous });

  const closedByHand: Reminder[] = ticked.map((l) => ({
    ...l,
    status: "done",
    history: [...l.history, { at: now, session_id: sessionId, event: "ticked by therapist" }],
  }));

  // Carried items: stay open unless closed with grounded evidence.
  const carried: Reminder[] = previous.map((loop) => {
    const u = proposal.updates.find((x) => x.id === loop.id);
    const keep = (): Reminder => ({ ...loop, history: [...loop.history, { at: now, session_id: sessionId, event: "carried forward" }] });
    if (!u || u.status === "still_open") return keep();
    const check = checkSpan(note, u.evidence_span);
    if (!check.ok) {
      rejected.push({ item: u, reason: `kept open: closing evidence failed (${check.reason})` });
      return keep();
    }
    return {
      ...loop,
      status: "done",
      history: [...loop.history, { at: now, session_id: sessionId, event: "closed", evidence: u.evidence_span ?? undefined }],
    };
  });

  // New items.
  const fresh: Reminder[] = [];
  const count: Record<Card, number> = { todo: 0, check_in: 0, prep: 0 };
  for (const c of proposal.candidates) {
    if (!ITEM_TYPES.includes(c.type)) {
      rejected.push({ item: c, reason: `unknown type "${c.type}"` });
      continue;
    }
    const check = checkSpan(note, c.source_span);
    if (!check.ok) {
      rejected.push({ item: c, reason: check.reason });
      continue;
    }
    if ([...stillOpen, ...fresh].some((l) => isDuplicate(l, c))) {
      rejected.push({ item: c, reason: "duplicate of an item already open" });
      continue;
    }
    const card = cardOf(c.type);
    if (count[card] >= CAPS[card]) {
      rejected.push({ item: c, reason: `over the ${CAPS[card]}-per-session cap for ${card}` });
      continue;
    }
    count[card]++;
    const third = card === "todo" ? c.third_party?.trim() || null : null;
    const item: Reminder = {
      type: c.type,
      card,
      title: c.title.trim(),
      source_span: c.source_span.trim(),
      third_party: third,
      due: c.due && ISO_DATE.test(c.due) ? c.due : null,
      id: loopId(sessionId, c),
      session_id: sessionId,
      status: "open",
      consent_required: Boolean(third),
      history: [{ at: now, session_id: sessionId, event: "opened" }],
    };
    if (manual.has(itemKey(item))) {
      item.status = "done";
      item.history.push({ at: now, session_id: sessionId, event: "ticked by therapist" });
    }
    fresh.push(item);
  }

  const title = proposal.session_title?.trim() || "Session";
  return { title, reminders: [...closedByHand, ...carried, ...fresh], rejected };
}

/** Older name, same function shape the earlier tests and eval used ({ loops }). */
export async function runOpenLoops(input: RunInput) {
  const r = await runReminders(input);
  return { loops: r.reminders, rejected: r.rejected, title: r.title };
}
