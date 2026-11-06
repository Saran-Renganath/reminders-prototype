// A no-AI baseline: keyword rules over the note's sentences.
// It exists so the whole pipeline (span check, carry-forward, ticks, evals, UI) runs offline,
// and so the model has something to beat. It is deliberately simple and will miss
// anything phrased in a way the patterns don't expect.

import type { Proposal, ProposeInput, Provider } from "./provider.js";
import type { Candidate, CarryUpdate, Reminder } from "./types.js";

const LETTER = /\b(letters?|reports?|forms?|summary|superbill|note)\b/i;
const REQUEST = /\b(request(?:ed|s)?|asked|asks|needs?|brought|wants?)\b/i;
const BILLING = /\b(billing|insurance|fees?|receipts?|invoices?|refunds?|waived?|superbill)\b/i;
const QUESTION = /\b(ask(?:ed|s)?|question|whether|wonder(?:ed|s)?|if I can)\b/i;
const CHECKPOINT = /\b(?:if no improvement|if [^.]*?(?:haven't|hasn't|don't|doesn't)|consider|revisit|reassess)\b[^.]*?\b(?:in|within|after)\s+(\d+|one|two|three|four)\s+(day|week|month)s?\b/i;
const TODO_DONE = /\b(was sent|were sent|sent|provided|submitted|faxed|emailed|waived|signed off|agreed to hold off|decided)\b/i;
const NOT_DONE = /\b(not sent|not yet|drafted|draft|waiting|pending|started)\b/i;
const THIRD_PARTY = /\b(family doctor|doctor|physician|psychiatrist|employer|insurer|school counsellor|school|lawyer|EAP)\b/i;
const HEADER = /^[A-Z][A-Za-z &/]{2,40}$/;
const STOP = new Set(["send", "provide", "answer", "question", "about", "decide", "complete", "with", "from", "that", "this", "continue", "review", "keep", "practice", "client", "session"]);
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };

export interface Line { section: string; text: string }

/** Split the note into sentences tagged with the section heading they sit under. */
export function lines(note: string): Line[] {
  const out: Line[] = [];
  let section = "";
  for (const raw of note.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (HEADER.test(line) && !/[.!?]$/.test(line)) { section = line.toLowerCase(); continue; }
    if (/^n\/?a\b/i.test(line)) continue;
    for (const s of line.split(/(?<=[.!?])\s+(?=[A-Z])/)) if (s.trim()) out.push({ section, text: s.trim() });
  }
  return out;
}

/** Sentences outside the homework and planning sections: what actually happened. */
export function sentences(note: string): string[] {
  return lines(note).filter((l) => !/homework|next session|plan for/.test(l.section)).map((l) => l.text);
}

function addDays(iso: string, n: number, unit: string): string | null {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null; // bad session date: no due date rather than a crash
  const days = unit.startsWith("week") ? n * 7 : unit.startsWith("month") ? n * 30 : n;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function letterTitle(s: string, to: string | null): string {
  if (/superbill/i.test(s)) return "Provide superbill";
  const m = s.match(/\b(?:a|an|the)\s+((?:[\w-]+\s){0,3}?(?:letter|report|form|summary|note))s?\b/i);
  const thing = (m?.[1] ?? "requested document").replace(/^(short|brief|quick)\s+/i, "");
  if (/form$/i.test(thing)) return `Complete ${thing}`;
  return to ? `Send ${thing} to ${to}` : `Send ${thing}`;
}

const BILLING_TOPICS = ["extended health insurance", "late cancellation fee", "superbill", "insurance", "fee", "receipt", "invoice", "refund", "billing"];
function billingTitle(s: string): string {
  const topic = BILLING_TOPICS.find((t) => s.toLowerCase().includes(t)) ?? "billing";
  return `Answer question about ${topic}`;
}

function checkpointTitle(s: string): string {
  const m = s.match(/((?:psychiatry |sleep clinic )?referral(?: to [\w\s-]+?)?)(?:\s+(?:if|for)\b|[.,])/i) ?? s.match(/(?:consider|revisit|reassess)\s+([\w\s-]+?)\s+(?:in|within|after|if)\b/i);
  return `Decide on ${m?.[1]?.trim() ?? "follow-up"}`;
}

/** First line under "Session Topics", else the first few words of the summary. */
export function titleByRules(note: string): string {
  const ls = lines(note);
  const topic = note.match(/Session Topics\s*\n\s*([^\n.]{3,60})\n/i)?.[1];
  if (topic && !/[.!?]$/.test(topic)) return topic.trim();
  const first = ls.find((l) => !/^(test session|therapist dictated)/i.test(l.text))?.text ?? "Session";
  return first.split(/[,.]/)[0].split(" ").slice(0, 6).join(" ");
}

export function proposeByRules(note: string, sessionDate: string): Candidate[] {
  const out: Candidate[] = [];
  for (const { section, text: s } of lines(note)) {
    if (/client homework/.test(section)) {
      out.push({ type: "client_homework", title: s.replace(/\.$/, ""), source_span: s, third_party: null, due: null });
      continue;
    }
    if (/topics for next session/.test(section)) {
      // A dated decision belongs in To do, not Prep, so it isn't shown twice.
      if (!CHECKPOINT.test(s)) {
        out.push({ type: "next_topic", title: s.replace(/\.$/, ""), source_span: s, third_party: null, due: null });
        continue;
      }
    }
    // Dictated summaries put homework inline: "Homework: keep a panic log and practice grounding daily."
    const hw = s.match(/^homework:\s*(.+)$/i);
    if (hw) {
      for (const part of hw[1].split(/,\s*|\s+and\s+/)) {
        const t = part.replace(/\.$/, "").trim();
        if (t.length >= 4) out.push({ type: "client_homework", title: t[0].toUpperCase() + t.slice(1), source_span: part.trim(), third_party: null, due: null });
      }
      continue;
    }
    const tp = s.match(THIRD_PARTY)?.[1] ?? null;
    if (LETTER.test(s) && REQUEST.test(s) && !NOT_DONE.test(s)) {
      out.push({ type: "letter_or_form", title: letterTitle(s, /superbill/i.test(s) ? null : tp), source_span: s, third_party: /superbill/i.test(s) ? null : tp, due: null });
    }
    if (BILLING.test(s) && QUESTION.test(s) && !/superbill/i.test(s)) {
      out.push({ type: "billing_or_admin", title: billingTitle(s), source_span: s, third_party: null, due: null });
    }
    const c = s.match(CHECKPOINT);
    if (c) {
      const n = WORDS[c[1].toLowerCase()] ?? Number(c[1]);
      out.push({ type: "checkpoint", title: checkpointTitle(s), source_span: s, third_party: null, due: addDays(sessionDate, n, c[2]) });
    }
  }
  return out;
}

const keywords = (t: string) =>
  t.toLowerCase().split(/[^a-z0-9-]+/).filter((w) => w.length > 2 && !STOP.has(w) && !["the", "and", "for", "two", "one"].includes(w)).map((w) => w.replace(/s$/, ""));

/**
 * Close a carried item when a sentence about what HAPPENED mentions it:
 * to-dos also need a done-verb and no "drafted / not sent"; homework and topics need two shared keywords.
 */
export function closeByRules(note: string, previous: Reminder[]): CarryUpdate[] {
  const happened = sentences(note);
  return previous.map((l) => {
    const keys = keywords(l.title);
    const need = Math.min(2, keys.length);
    const mentions = (s: string) => need > 0 && keys.filter((k) => s.toLowerCase().includes(k)).length >= need;
    const hit = l.card === "todo"
      ? happened.find((s) => TODO_DONE.test(s) && !NOT_DONE.test(s) && mentions(s))
      : happened.find((s) => mentions(s));
    return hit ? { id: l.id, status: "done", evidence_span: hit } : { id: l.id, status: "still_open", evidence_span: null };
  });
}

export class RulesProvider implements Provider {
  async propose({ note, sessionDate, previous }: ProposeInput): Promise<Proposal> {
    return { session_title: titleByRules(note), candidates: proposeByRules(note, sessionDate), updates: closeByRules(note, previous) };
  }
}
