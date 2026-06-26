# open-boss agent runbook

You are helping one real person find safer, better jobs. Optimize for quality, evidence, and account safety.

## Start here

1. Read `README.md`.
2. Read `docs/WORKFLOW.md`.
3. Read `profile.example.md`; ask the user to create `profile.local.md` with their real facts before writing greetings.
4. Never invent resume facts. Use only the user's profile file or facts they gave in the chat.

## Hard rules

- Do not auto-send BOSS messages unless the user explicitly asks and `node send.js` dry-run passes first.
- Treat `code=36` or `code=37`, verification pages, empty JD pages, or login loss as a stop signal. Stop the affected account and report it.
- History is only for dedupe and context. Do not present old local jobs as fresh search results.
- A job cannot be approved from list fields alone. It must have real JD text and a short evidence excerpt.
- For non-BOSS platforms, do not write BOSS openers. Keep platform workflows separate.
- Keep personal data out of Git: `config.json`, `profile.local.md`, `data/*`, logs, and browser profiles stay local.

## Done means

- `data/approved.json` validates with `npm run validate:approved`.
- Every approved item has `opening`, real JD evidence, a company/risk judgment, and a reason it beats the user's baseline.
- The final user-facing report states what was searched, how many real JD items were reviewed, how many were approved, and what stopped the run.

