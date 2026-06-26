# open-boss

半自动高质量求职流水线：搜索岗位、读取真实 JD、让 LLM 严格筛坑并写定制开场白，最后由你确认是否发送。

它不是群发器。目标是把有限的沟通次数花在真正值得聊的岗位上，避开培训贷、伪装销售、保险增员、夜班倒班、虚假高薪等坑。

## What It Does

```text
search candidates -> LLM shortlist -> read real JD -> LLM final review -> validate -> dry-run -> user-approved send
```

Key ideas:

- Real JD text is required before approval.
- Every approved job needs evidence and a baseline decision.
- BOSS messages are dry-run first; no accidental auto-send.
- Personal facts live in local files and stay out of Git.
- Multiple accounts are supported by separate browser profiles and CDP ports, but one account runs only one online task at a time.

## Install

```bash
git clone https://github.com/yinren112/open-boss.git
cd open-boss
npm install
npm run init
```

Then edit:

- `config.json`: city, keywords, optional `accounts`
- `profile.local.md`: copy from `profile.example.md` and fill your private resume facts and baseline

`config.json`, `profile.local.md`, and `data/*` are ignored by Git.

## Start Browser

Windows:

```cmd
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=19222 ^
  --user-data-dir="%USERPROFILE%\.open-boss\chrome-profile" ^
  https://www.zhipin.com/web/geek/jobs
```

macOS:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=19222 \
  --user-data-dir="$HOME/.open-boss/chrome-profile" \
  https://www.zhipin.com/web/geek/jobs
```

Log in manually, then check:

```bash
npm run check:accounts
```

## Daily Run

```bash
npm run harvest
```

Use `prompts/01_initial_filter.md` with your LLM to create:

```text
data/shortlist.json
```

Read real JD text:

```bash
npm run enrich
```

Use `prompts/02_final_filter_and_draft.md` with your LLM to create:

```text
data/approved.json
```

Validate:

```bash
npm run validate:approved
```

Dry-run message delivery:

```bash
npm run send:dry
```

Only after the user explicitly approves:

```bash
npm run send -- --send
```

## Working With Agents

Codex, Claude Code, Antigravity, or similar local coding agents should start from:

- `AGENTS.md`
- `docs/WORKFLOW.md`
- `profile.local.md`

The agent should report:

- what was searched
- how many candidates were found
- how many real JD pages were reviewed
- which jobs passed and why
- what stopped the run, if anything

No padding. If nothing beats your baseline today, the correct answer is a clean zero.

## Safety Rules

- `code=36` or `code=37`: stop the affected account.
- Verification page or repeated empty JD: stop and report.
- Do not retry by swapping keywords to force more volume.
- Do not send BOSS messages without a passing dry-run and explicit approval.
- Do not invent resume facts for openers.
- Do not approve a job without JD evidence.

## Privacy

Before publishing changes:

```bash
npm run privacy:scan
git status --short
```

See `docs/PRIVACY.md`.

## Useful Files

- `docs/WORKFLOW.md`: full workflow
- `AGENTS.md`: rules for local AI agents
- `profile.example.md`: private profile template
- `config.example.json`: public config template
- `prompts/`: LLM prompts
- `data/approved.example.json`: expected approval format

## License

[MIT](./LICENSE)
