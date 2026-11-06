import Anthropic from "@anthropic-ai/sdk";
import type { Candidate, CarryUpdate, OpenLoop } from "./types.js";

export interface ProposeInput {
  note: string;
  sessionDate: string; // ISO date, used to turn "in 3 weeks" into a due date
  previous: OpenLoop[]; // items still open from earlier sessions with this client
}

export interface Proposal {
  candidates: Candidate[];
  updates: CarryUpdate[];
}

/** Anything that can propose loops. The pipeline never trusts it: see ground.ts. */
export interface Provider {
  propose(input: ProposeInput): Promise<Proposal>;
}

export const SYSTEM = `You read a therapist's session note and list what the THERAPIST still owes after the session.

Only three kinds of item count:
- letter_or_form: a letter, report, form or document someone asked for (doctor, insurer, employer, school, lawyer, the client).
- billing_or_admin: a billing, insurance, receipt, scheduling-policy or fee question the client raised that needs an answer.
- checkpoint: a dated or conditional decision the therapist committed to revisit (e.g. "consider a referral if no improvement in 3 weeks").

Do NOT include: client homework, ordinary "next session" plans, or clinical observations.

Completed means a concrete action is stated (e.g. "receipt provided", "letter sent", "form signed"). Vague lines such as "addressed", "discussed", "reviewed" or "talked about" do NOT mean completed: if a request appears and only a vague line follows it, the item is still owed.

Rules:
- source_span must be copied EXACTLY from the note, 6 to 25 words, with no edits. If you can't quote it, leave the item out.
- Prefer missing an item over inventing one.
- due: ISO date (YYYY-MM-DD) only when the note implies timing; compute it from the session date. Otherwise null.
- third_party: who receives the output if not the client (e.g. "family doctor", "insurer"), else null.

You may also be given items still open from earlier sessions. For each, report status "done" only if THIS note shows it was handled, and quote that evidence exactly in evidence_span. Otherwise "still_open" with evidence_span null. Never repeat an earlier item as a new candidate.`;

export const TOOL: Anthropic.Tool = {
  name: "report_open_loops",
  description: "Report the follow-ups the therapist owes, and the status of earlier open items.",
  input_schema: {
    type: "object",
    properties: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["letter_or_form", "billing_or_admin", "checkpoint"] },
            title: { type: "string", description: "Short imperative task, under 10 words." },
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
    required: ["candidates", "updates"],
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
      max_tokens: 1500,
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
    if (!block || block.type !== "tool_use") throw new Error("Model did not return the report_open_loops tool call.");
    const out = block.input as Partial<Proposal>;
    return { candidates: out.candidates ?? [], updates: out.updates ?? [] };
  }
}

/** Returns a fixed proposal. Used by tests, and to show the span check rejecting a made-up item. */
export class FixedProvider implements Provider {
  constructor(private proposal: Proposal) {}
  async propose(): Promise<Proposal> {
    return this.proposal;
  }
}
