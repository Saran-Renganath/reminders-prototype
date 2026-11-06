// An "open loop" is something a session left unfinished that the therapist owes:
// a letter or form, an admin question to answer, or a dated checkpoint.

export type LoopType = "letter_or_form" | "billing_or_admin" | "checkpoint";
export type LoopStatus = "open" | "done" | "dismissed";

/** What the model proposes. Nothing is trusted until it passes the span check. */
export interface Candidate {
  type: LoopType;
  /** Short task wording, e.g. "Send progress letter to family doctor". */
  title: string;
  /** Exact quote from the note that shows this item exists. */
  source_span: string;
  /** Doctor, insurer, employer, school... null if it stays with the client. */
  third_party: string | null;
  /** ISO date if the note implies one ("in 3 weeks"), else null. */
  due: string | null;
}

export interface OpenLoop extends Candidate {
  id: string;
  session_id: string;
  status: LoopStatus;
  /** True when a third party is involved: the UI shows a consent check before drafting. */
  consent_required: boolean;
  history: { at: string; session_id: string; event: string; evidence?: string }[];
}

/** The model's view of an item carried in from an earlier session. */
export interface CarryUpdate {
  id: string;
  status: "done" | "still_open";
  /** Required when status is "done": the quote in the NEW note that shows it was handled. */
  evidence_span: string | null;
}

export interface Rejected {
  item: Candidate | CarryUpdate;
  reason: string;
}

export interface ExtractionResult {
  loops: OpenLoop[];
  rejected: Rejected[];
}
