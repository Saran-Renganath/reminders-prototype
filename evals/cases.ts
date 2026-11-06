// Hand-labelled expectations for the eval notes.
// All notes are fictional. jordan-s3 and jordan-s4 are notes Klarify generated in a trial
// account from fictional summaries; the rest were written for this prototype.

import type { LoopType } from "../src/types.js";

export interface ExpectedNew {
  type: LoopType;
  /** A phrase the kept item's source_span must contain (normalised). */
  match: string;
}

export interface Session {
  file: string;
  date: string;
  expectNew: ExpectedNew[];
  /** Phrases identifying carried items that this note should close. */
  expectClosed: string[];
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
        expectClosed: ["progress letter", "extended health insurance"],
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
    client: "Casey (fictional, should produce nothing)",
    sessions: [{ file: "casey-s1.txt", date: "2026-11-04", expectNew: [], expectClosed: [] }],
  },
];
