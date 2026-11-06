// A no-AI baseline: keyword rules over the note's sentences.
// It exists so the whole pipeline (span check, carry-forward, evals, UI) runs offline,
// and so the model has something to beat. It is deliberately simple and will miss
// anything phrased in a way the patterns don't expect.

import type { Proposal, ProposeInput, Provider } from "./provider.js";
import type { Candidate, CarryUpdate, OpenLoop } from "./types.js";

const LETTER = /\b(letters?|reports?|forms?)\b/i;
const REQUEST = /\b(request(?:ed|s)?|asked|asks|needs?|brought|wants?)\b/i;
const BILLING = /\b(billing|insurance|fees?|receipts?|invoices?|refunds?|waived?)\b/i;
const QUESTION = /\b(ask(?:ed|s)?|question|whether|wonder(?:ed|s)?)\b/i;
const CHECKPOINT = /\b(?:if no improvement|consider|revisit|reassess)\b[^.]*?\b(?:in|within|after)\s+(\d+)\s+(day|week|month)s?\b/i;
const DONE = /\b(was sent|were sent|sent|provided|completed|submitted|faxed|emailed|waived|signed off)\b/i;
const THIRD_PARTY = /\b(family doctor|doctor|physician|psychiatrist|employer|insurer|school|lawyer|EAP)\b/i;
const HEADER = /^[A-Z][A-Za-z &/]{2,40}$/;
const STOP = new Set(["send", "answer", "question", "about", "decide", "complete", "with", "from", "that", "this"]);

/** Split into sentences, skipping the Client Homework section (homework isn't owed by the therapist). */
export function sentences(note: string): string[] {
  const out: string[] = [];
  let skip = false;
  for (const raw of note.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (HEADER.test(line) && !/[.!?]$/.test(line)) {
      skip = /client homework/i.test(line);
      continue;
    }
    if (skip || /^n\/?a\b/i.test(line)) continue;
    for (const s of line.split(/(?<=[.!?])\s+(?=[A-Z])/)) if (s.trim()) out.push(s.trim());
  }
  return out;
}

function addDays(iso: string, n: number, unit: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const days = unit.startsWith("week") ? n * 7 : unit.startsWith("month") ? n * 30 : n;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function letterTitle(s: string): string {
  const m = s.match(/((?:[\w-]+\s){0,3}(?:letter|report|form))s?\b/i);
  const thing = (m?.[1] ?? "requested document").replace(/^(a|an|the|short)\s+/i, "");
  return /form$/i.test(thing) ? `Complete ${thing}` : `Send ${thing}`;
}

const BILLING_TOPICS = ["extended health insurance", "late cancellation fee", "insurance", "fee", "receipt", "invoice", "refund", "billing"];

function billingTitle(s: string): string {
  // Most specific topic wins, wherever it appears in the sentence.
  const topic = BILLING_TOPICS.find((t) => s.toLowerCase().includes(t)) ?? "billing";
  return `Answer question about ${topic}`;
}

function checkpointTitle(s: string): string {
  const m = s.match(/(referral to [\w\s-]+?)\s+if\b/i) ?? s.match(/(?:consider|revisit|reassess)\s+([\w\s-]+?)\s+(?:in|within|after|if)\b/i);
  return `Decide on ${m?.[1]?.trim() ?? "follow-up"}`;
}

export function proposeByRules(note: string, sessionDate: string): Candidate[] {
  const out: Candidate[] = [];
  for (const s of sentences(note)) {
    const tp = s.match(THIRD_PARTY)?.[1] ?? null;
    if (LETTER.test(s) && REQUEST.test(s)) {
      out.push({ type: "letter_or_form", title: letterTitle(s), source_span: s, third_party: tp, due: null });
    }
    if (BILLING.test(s) && QUESTION.test(s)) {
      out.push({ type: "billing_or_admin", title: billingTitle(s), source_span: s, third_party: null, due: null });
    }
    const c = s.match(CHECKPOINT);
    if (c) {
      out.push({ type: "checkpoint", title: checkpointTitle(s), source_span: s, third_party: null, due: addDays(sessionDate, Number(c[1]), c[2]) });
    }
  }
  return out;
}

const keywords = (t: string) =>
  t.toLowerCase().split(/[^a-z0-9-]+/).filter((w) => w.length > 3 && !STOP.has(w));

/** Close a carried item when a sentence says something was done AND mentions what the item is about. */
export function closeByRules(note: string, previous: OpenLoop[]): CarryUpdate[] {
  const done = sentences(note).filter((s) => DONE.test(s));
  return previous.map((l) => {
    const keys = keywords(l.title);
    const hit = done.find((s) => keys.filter((k) => s.toLowerCase().includes(k)).length >= Math.min(2, keys.length));
    return hit ? { id: l.id, status: "done", evidence_span: hit } : { id: l.id, status: "still_open", evidence_span: null };
  });
}

export class RulesProvider implements Provider {
  async propose({ note, sessionDate, previous }: ProposeInput): Promise<Proposal> {
    return { candidates: proposeByRules(note, sessionDate), updates: closeByRules(note, previous) };
  }
}
