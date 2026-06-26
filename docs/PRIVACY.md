# Privacy checklist

Before publishing or sharing this project:

```bash
npm run privacy:scan
git status --short
```

Do not commit:

- `config.json`
- `profile.local.md`
- `data/*` except documented examples
- browser profiles
- logs
- real resumes
- real job reports
- screenshots containing names, chats, phone numbers, or company conversations

The repository should contain only generic examples and templates. Put personal facts in `profile.local.md`, which is ignored by Git.

