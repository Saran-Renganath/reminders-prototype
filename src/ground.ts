// The span check. Every item must quote the note it came from.
// No matching quote, no item. This turns "did the model make it up?"
// into a string match you can unit test.

/** Normalise the things models routinely change when quoting: case, whitespace, quote marks, dashes. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‚‛`´]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[\s"'.,;:]+|[\s"'.,;:]+$/g, "")
    .trim();
}

export const MIN_SPAN_CHARS = 12;

export type SpanCheck = { ok: true } | { ok: false; reason: string };

/**
 * A span passes when, after normalising, it appears verbatim in the note
 * and is long enough to mean something (stops one-word "quotes" like "letter").
 */
export function checkSpan(note: string, span: string | null | undefined): SpanCheck {
  if (!span || !span.trim()) return { ok: false, reason: "no source quote given" };
  const s = normalize(span);
  if (s.length < MIN_SPAN_CHARS) return { ok: false, reason: `quote too short (${s.length} chars)` };
  if (!normalize(note).includes(s)) return { ok: false, reason: "quote not found in the note" };
  return { ok: true };
}
