// Reminders: what a session leaves for later, split into three cards.
//
//   To do          things the THERAPIST owes (letters, forms, billing answers, dated decisions)
//   Check in on    homework the CLIENT agreed to, to ask about next time
//   Prep           topics planned for the next session
//
// Every item quotes the note it came from, stays open across sessions, and is ticked
// automatically only when a later note shows it happened.

export type TodoType = "letter_or_form" | "billing_or_admin" | "checkpoint";
export type ItemType = TodoType | "client_homework" | "next_topic";
export type Card = "todo" | "check_in" | "prep";
export type ItemStatus = "open" | "done";

export const TODO_TYPES: TodoType[] = ["letter_or_form", "billing_or_admin", "checkpoint"];
export const ITEM_TYPES: ItemType[] = [...TODO_TYPES, "client_homework", "next_topic"];

export function cardOf(type: ItemType): Card {
  if (type === "client_homework") return "check_in";
  if (type === "next_topic") return "prep";
  return "todo";
}

/** What the model proposes. Nothing is trusted until it passes the span check. */
export interface Candidate {
  type: ItemType;
  /** Short wording, e.g. "Send progress letter to family doctor". */
  title: string;
  /** Exact quote from the note that shows this item exists. */
  source_span: string;
  /** To-dos only: doctor, insurer, employer, school... null otherwise. */
  third_party: string | null;
  /** ISO date if the note implies one ("in 3 weeks"), else null. */
  due: string | null;
}

export interface Reminder extends Candidate {
  id: string;
  card: Card;
  session_id: string;
  status: ItemStatus;
  /** True for to-dos involving a third party: the UI shows a consent check. */
  consent_required: boolean;
  history: { at: string; session_id: string; event: string; evidence?: string }[];
}

/** The model's view of an item carried in from an earlier session. */
export interface CarryUpdate {
  id: string;
  status: "done" | "still_open";
  /** Required when status is "done": the quote in the NEW note that shows it happened. */
  evidence_span: string | null;
}

export interface Rejected {
  item: Candidate | CarryUpdate;
  reason: string;
}

export interface SessionResult {
  /** Short session topic, e.g. "Work anxiety and sleep". */
  title: string;
  reminders: Reminder[];
  rejected: Rejected[];
}

/** Kept so older imports keep working. */
export type OpenLoop = Reminder;
export type LoopType = ItemType;
