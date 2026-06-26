# open-boss workflow

This is the current reusable workflow distilled from real daily job-search runs. It is intentionally semi-automatic: scripts gather and verify, an LLM helps judge and draft, and the user remains in control of sending.

## 0. Set your baseline

Before searching, write a private `profile.local.md` from `profile.example.md`.

Define:

- target city and commute limits
- real resume facts that may be used in greetings
- must-have job conditions
- your current offer or fallback job, if any
- job lines that are worth taking even if salary is slightly lower because they build future value
- hard exclusions such as sales, loans, insurance recruiting, training fees, night shifts, or fake admin roles

Approved jobs should beat that baseline. If none do, the correct output is "no better job today".

## 1. Open the browser

Use a visible Chrome or Edge profile that is already logged into BOSS and exposes a CDP port.

Windows example:

```cmd
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=19222 ^
  --user-data-dir="%USERPROFILE%\.open-boss\chrome-profile" ^
  https://www.zhipin.com/web/geek/jobs
```

Check it:

```bash
npm run check:accounts
```

For more than one account, add accounts in `config.json` under `accounts`, each with its own browser profile and port. One account must never have two online jobs running at the same time.

## 2. Gather candidates

Run search only when you need fresh candidates:

```bash
npm run harvest
```

This writes:

- `data/candidates_latest.md`
- `data/candidates_latest.jsonl`

If a request returns `code=36` or `code=37`, stop that account. Do not retry with new keywords to "use up" the day.

## 3. First LLM pass

Use `prompts/01_initial_filter.md`.

The output must be `data/shortlist.json`, copied from the original JSON objects. Keep it small. List fields decide what is worth spending JD-reading quota on; they do not decide final approval.

## 4. Read real JD text

```bash
npm run enrich
```

Default mode opens real job detail pages and reads DOM text. This is slower but safer than internal detail APIs. If verification appears or JD text is empty repeatedly, stop and report it.

## 5. Final LLM review and opener drafting

Use `prompts/02_final_filter_and_draft.md`.

Each approved job must include:

- exact job IDs copied from the input
- `postDescription` or `jd`
- `opening`
- `judge.evidence`: an exact excerpt from the JD
- `judge.companyAssessment`: why the company looks acceptable or risky
- `judge.riskDecision`: how sales, finance, shift, training, or other risks were handled
- `judge.baselineDecision`: why this beats the user's baseline or belongs to a future-value line

Save as `data/approved.json`.

## 6. Validate before sending

```bash
npm run validate:approved
```

Fix validation failures before any send attempt.

Then dry-run:

```bash
npm run send:dry
```

Only after dry-run passes and the user explicitly approves:

```bash
npm run send -- --send
```

## 7. Daily report

When handing results to the user, keep it short:

- what sources were searched
- how many candidates were gathered
- how many real JDs were reviewed
- approved jobs and their opener text
- stop reason, if any

Do not pad the list. A small clean list is better than a large risky one.

