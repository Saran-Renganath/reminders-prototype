import Anthropic from "@anthropic-ai/sdk";
import type { Candidate, CarryUpdate, Reminder } from "./types.js";

export interface ProposeInput {
  note: string;
  sessionDate: string; // ISO date, used to turn "in 3 weeks" into a due date
  previous: Reminder[]; // items still open from earlier sessions with this client
}

export interface Proposal {
  session_title?: string;
  candidates: Candidate[];
  updates: CarryUpdate[];
}

/** Anything that can propose reminders. The pipeline never trusts it: see ground.ts. */
export interface Provider {
  propose(input: ProposeInput): Promise<Proposal>;
}

export const SYSTEM = `You read a therapist's session note and build reminders for the next session.

Five kinds of item:

THERAPIST TO-DOS. Read the WHOLE note for these, not just a "therapist homework" section; requests often sit under admin or summary lines while the homework section says N/A.
- letter_or_form: a letter, report, summary, form or document someone asked the therapist for (doctor, insurer, employer, school, lawyer, the client).
- billing_or_admin: a billing, insurance, superbill, receipt, fee or policy question the client raised that needs an answer.
- checkpoint: a dated or conditional decision the therapist committed to revisit (e.g. "consider a referral if no improvement in 3 weeks").

CLIENT HOMEWORK
- client_homework: something the client agreed to do before next time, so the therapist can check in on it.

PREP
- next_topic: something specific planned for the next session. Skip generic lines like "next session in one week".

Completed means a concrete action is stated (e.g. "receipt provided", "letter sent", "form signed"). Vague lines such as "addressed", "discussed", "went over" or "talked about" do NOT complete a to-do. Drafted, started or prepared is NOT done either.

Rules:
- source_span must be copied EXACTLY from the note, 4 to 25 words, with no edits. If you can't quote it, leave the item out.
- Prefer missing an item over inventing one.
- title: short and plain, under 10 words.
- due: ISO date (YYYY-MM-DD) only when the note implies timing; compute it from the session date. Otherwise null.
- third_party: for to-dos, who receives the output if not the client (e.g. "family doctor", "lawyer"), else null. Always null for homework and topics.
- session_title: the main topic of this session in 2 to 6 words, e.g. "Work anxiety and sleep".

You may also be given items still open from earlier sessions. For each, report status "done" only if THIS note shows it happened, and quote that evidence exactly in evidence_span:
- to-do: the concrete action was taken (sent, provided, signed, decided).
- client_homework: the note shows the homework was reviewed or reported on, even if only partly done.
- next_topic: the note shows the topic was actually covered in this session.
Otherwise "still_open" with evidence_span null. Never repeat an earlier item as a new candidate.`;

export const TOOL: Anthropic.Tool = {
  name: "report_reminders",
  description: "Report reminders from this session and the status of earlier open items.",
  input_schema: {
    type: "object",
    properties: {
      session_title: { type: "string", description: "Main topic of the session, 2 to 6 words." },
      candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["letter_or_form", "billing_or_admin", "checkpoint", "client_homework", "next_topic"] },
            title: { type: "string", description: "Short and plain, under 10 words." },
            source_span: { type: "string", description: "Exact quote from the note." },
            third_party: { type: ["string", "null"] },
            due: { type: ["string", "null"], description: "YYYY-MM-DD or null" },
          },
          required: ["type", "title", "source_span", "third_party", "due"],
        },
      },
      updates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            status: { type: "string", enum: ["done", "still_open"] },
            evidence_span: { type: ["string", "null"] },
          },
          required: ["id", "status", "evidence_span"],
        },
      },
    },
    required: ["session_title", "candidates", "updates"],
  },
};

export class AnthropicProvider implements Provider {
  private client: Anthropic;
  constructor(
    private model = process.env.OPEN_LOOPS_MODEL ?? "claude-haiku-5-5",
    apiKey = process.env.ANTHROPIC_API_KEY,
  ) {
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.");
    this.client = new Anthropic({ apiKey });
  }

  async propose({ note, sessionDate, previous }: ProposeInput): Promise<Proposal> {
    const earlier = previous.length
      ? previous.map((l) => `- id=${l.id} | ${l.type} | ${l.title} | due=${l.due ?? "none"}`).join("\n")
      : "(none)";

    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 2500,
      temperature: 0,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [
        {
          role: "user",
          content: `Session date: ${sessionDate}\n\nItems still open from earlier sessions:\n${earlier}\n\n<note>\n${note}\n</note>`,
        },
      ],
    });

    const block = res.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") throw new Error("Model did not return the report_reminders tool call.");
    const out = block.input as Partial<Proposal>;
    return { session_title: out.session_title, candidates: out.candidates ?? [], updates: out.updates ?? [] };
  }
}

/** Returns a fixed proposal. Used by tests, and to show the span check rejecting a made-up item. */
export class FixedProvider implements Provider {
  constructor(private proposal: Proposal) {}
  async propose(): Promise<Proposal> {
    return this.proposal;
  }
}
