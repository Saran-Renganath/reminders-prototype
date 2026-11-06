// Hand-labelled expectations for the eval notes. Scored on the To do card, where a miss
// costs the therapist; Check in on and Prep are reported but not scored.
// All notes are fictional. jordan-s3 and jordan-s4 are notes Klarify generated in a trial
// account from fictional summaries; the rest were written for this prototype.

import type { LoopType } from "../src/types.js";

export interface ExpectedNew {
  /** A list means either label is acceptable (a superbill is both a document and a billing item). */
  type: LoopType | LoopType[];
  /** A phrase the kept item's source_span must contain (normalised). */
  match: string;
}

export interface Session {
  file: string;
  date: string;
  expectNew: ExpectedNew[];
  /** Carried items this note should close, identified by type + a phrase from their source quote. */
  expectClosed: ExpectedNew[];
}

export interface Case {
  client: string;
  sessions: Session[];
}

export const CASES: Case[] = [
  {
    client: "Jordan (test)",
    sessions: [
      {
        file: "jordan-s3.txt",
        date: "2026-11-06",
        expectNew: [
          { type: "letter_or_form", match: "progress letter" },
          { type: "billing_or_admin", match: "extended health insurance" },
          { type: "checkpoint", match: "sleep clinic" },
        ],
        expectClosed: [],
      },
      { file: "jordan-s4.txt", date: "2026-11-13", expectNew: [], expectClosed: [] },
      {
        file: "jordan-s5.txt",
        date: "2026-11-20",
        expectNew: [],
        expectClosed: [
          { type: "letter_or_form", match: "progress letter" },
          { type: "billing_or_admin", match: "extended health insurance" },
        ],
      },
    ],
  },
  {
    client: "Priya (fictional)",
    sessions: [
      {
        file: "priya-s2.txt",
        date: "2026-11-05",
        expectNew: [
          { type: "letter_or_form", match: "return-to-work" },
          { type: "letter_or_form", match: "eap authorization form" },
          { type: "billing_or_admin", match: "late cancellation fee" },
        ],
        expectClosed: [],
      },
    ],
  },
  {
    // Dictated summaries with two traps: a vague "went over the paperwork" (closes nothing)
    // and a summary that is "drafted but not sent" (must stay open).
    client: "Maya (fictional, traps)",
    sessions: [
      {
        file: "maya-s1.txt",
        date: "2026-11-06",
        expectNew: [
          { type: "letter_or_form", match: "lawyer needs a short summary" },
          { type: ["letter_or_form", "billing_or_admin"], match: "superbill" },
          { type: "checkpoint", match: "psychiatry referral" },
        ],
        expectClosed: [],
      },
      {
        file: "maya-s2.txt",
        date: "2026-11-13",
        expectNew: [{ type: "letter_or_form", match: "school counsellor" }],
        expectClosed: [],
      },
      {
        file: "maya-s3.txt",
        date: "2026-11-20",
        expectNew: [],
        expectClosed: [
          { type: ["letter_or_form", "billing_or_admin"], match: "superbill" },
          { type: "checkpoint", match: "psychiatry referral" },
        ],
      },
    ],
  },
  {
    client: "Casey (fictional, nothing owed by the therapist)",
    sessions: [{ file: "casey-s1.txt", date: "2026-11-04", expectNew: [], expectClosed: [] }],
  },
];
