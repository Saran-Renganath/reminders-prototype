import { describe, expect, it } from "vitest";
import { checkSpan, normalize } from "../src/ground.js";

const note = `Administrative Matters
The client mentioned their family doctor requested a short progress letter.
The client asked about billing sessions to extended health insurance.`;

describe("span check", () => {
  it("accepts an exact quote", () => {
    expect(checkSpan(note, "family doctor requested a short progress letter").ok).toBe(true);
  });

  it("tolerates case, curly quotes, line breaks and trailing punctuation", () => {
    expect(checkSpan(note, "  Family Doctor requested\na short progress letter.  ").ok).toBe(true);
    expect(normalize("“if I miss this release”")).toBe('if i miss this release');
  });

  it("rejects a paraphrase", () => {
    const r = checkSpan(note, "the doctor wants a progress update letter");
    expect(r).toEqual({ ok: false, reason: "quote not found in the note" });
  });

  it("rejects a sentence the note never said (the 'Thank you for referring' case)", () => {
    expect(checkSpan(note, "family doctor referred the client for anxiety").ok).toBe(false);
  });

  it("rejects quotes too short to prove anything", () => {
    expect(checkSpan(note, "letter").ok).toBe(false);
  });

  it("rejects a missing quote", () => {
    expect(checkSpan(note, null).ok).toBe(false);
    expect(checkSpan(note, "   ").ok).toBe(false);
  });
});
