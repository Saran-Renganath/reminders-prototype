# Open Loops

A small prototype for one idea: **after every therapy session note, list what the therapist still owes, quote where it came from, and keep it open until it's done.**

I built this after running two test sessions through a Klarify trial account. Session 3's note logged that the family doctor wanted a progress letter and the client asked about insurance billing, then listed therapist homework as "N/A". By session 4, both had disappeared. Klara could find them and draft the letter, but only when asked.

## What it does

```
note ──▶ propose (Claude, one tool call) ──▶ span check ──▶ dedupe + cap ──▶ open loops
                                               │
earlier open loops ──▶ "is this closed?" ──────┘  (closing also needs a quote from the new note)
```

- **Three item types:** `letter_or_form`, `billing_or_admin`, `checkpoint` (dated or conditional decisions like "consider a referral in 3 weeks").
- **Span check:** every item must quote the note exactly (after normalising case, whitespace and quote marks). No quote, no item. See `src/ground.ts`.
- **Carry-forward:** items stay open across sessions. A carried item only closes if the new note contains a quote proving it was handled.
- **Guards:** max 3 new items per session, duplicate detection against what's already open, malformed due dates ignored, consent flag whenever a third party (doctor, insurer, employer) is involved.
- **Cheap by design:** runs on the note, not the transcript, with a small model and one structured call. Drafting the letter itself is out of scope here and would only run when the therapist taps.

## Run it (no API key needed)

```bash
npm install
npm test                                   # 21 unit tests, fully offline
npm run dev                                # http://localhost:3000
npm run eval -- --provider=rules           # offline keyword baseline
npm run eval -- --provider=claude-code     # real Claude, via your Claude subscription
```

Three ways to run extraction:

| Provider | Needs | What it is |
|---|---|---|
| `rules` | nothing | Keyword baseline, no AI. Tuned on the sample notes, so treat its scores as a pipeline check, not a quality claim. |
| `claude-code` | Claude Code CLI, signed in once with your Claude plan | Same prompt and JSON schema as the API, sent through `claude -p` with all tools disabled. |
| `api` | `ANTHROPIC_API_KEY` in `.env` | Direct API call with forced tool use. |

With no flag, it uses the API if a key is set, then Claude Code if installed, then rules. Step-by-step instructions are in `TESTING.md`.

## Layout

| Path | What |
|---|---|
| `src/ground.ts` | Normalise + span check |
| `src/pipeline.ts` | Ground, carry forward, close with evidence, dedupe, cap |
| `src/provider.ts` | Shared prompt and schema, API provider, fixed provider for tests |
| `src/claudeCode.ts` | Claude Code CLI provider (no API key) |
| `src/rules.ts` | Offline keyword baseline |
| `evals/` | Five fictional notes across three clients, hand-labelled expectations, eval runner |
| `test/` | Unit tests for the span check and pipeline |
| `web/index.html` | One-page demo UI; click any item to highlight its quote in the note |

## Data

All notes are fictional. `jordan-s3.txt` and `jordan-s4.txt` are notes Klarify generated in a trial account from fictional summaries I wrote. Nothing here touches real client data.

## Not done yet

- Results from `npm run eval -- --provider=claude-code` on notes the rules were not tuned on
- Drafting the letter or reply from an open item
- Persistence (items live in memory per request)
- Checking the three item types with real therapists
