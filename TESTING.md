# Testing Open Loops, step by step

No API key needed. About 15 minutes.

## 1. Install Node.js (once)

Download the LTS version from nodejs.org and install it. Check it worked:

```bash
node -v    # should print v20 or higher
```

## 2. Unzip and install

```bash
cd open-loops
npm install
```

## 3. Run the tests (offline)

```bash
npm test
```

Expect `21 passed`. These check the span check, carry-forward, closing with evidence, duplicates, the cap, and both no-key providers.

## 4. Try the app (offline)

```bash
npm run dev
```

Open http://localhost:3000.

- Pick **Rules (offline, no AI)** and press **Run**. You should see 3 items after session 3, the same 3 carried into session 4, and 2 closed in session 5.
- Click any item. Its quote lights up in the note on the left.
- Press **Demo without a key**. An invented "Thank the referring doctor" item gets dropped, and so does a false "insurer approved" closing claim.

## 5. Run it with real Claude, no API key

```bash
npm install -g @anthropic-ai/claude-code
claude          # sign in with your Claude account when it asks, then type /exit
```

Then either pick **Claude Code (your subscription)** in the app and press Run, or:

```bash
npm run eval -- --provider=claude-code
```

Each session takes a few seconds. Save the Results block at the end.

## 6. The real test: notes it has never seen

The sample notes were written alongside the rules, so the rules score well on them. To see how it really does:

1. In the app, click a session tab and replace the text with a new note you write yourself.
   Mix in follow-ups phrased in new ways ("her lawyer needs a summary for court", "can I get a superbill"),
   plus things that should NOT count (client homework, routine next-session plans).
2. Run it with **Rules**, then with **Claude Code**, and compare.
3. Note what each one got right, missed or invented. That comparison is the most useful thing to show Bergie.

## If something goes wrong

| Message | Fix |
|---|---|
| `Couldn't start "claude"` | Step 5 install didn't finish. Re-run it, then open a new terminal. |
| `Claude Code error: Authentication error` | Run `claude` once in a terminal and sign in. |
| `Claude Code timed out` | Try again. If it keeps happening, run with `OPEN_LOOPS_CC_MODEL=haiku`. |
| Port 3000 in use | `PORT=3001 npm run dev` (Windows PowerShell: `$env:PORT=3001; npm run dev`) |
