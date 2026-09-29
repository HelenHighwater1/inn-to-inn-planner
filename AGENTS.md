# Checks (must pass before committing)

These mirror the CI jobs in `.github/workflows/ci.yml`:

- `npm run lint` — Oxlint
- `npx tsc -b` — typecheck
- `npm test` — Vitest
- `npm run build`

# Workflow

- All changes to `main` go through a PR. Greptile reviews every PR (config: `.greptile/config.json`).
- NEVER merge PRs — not with `gh pr merge`, `--auto`, or `--admin`. Open the PR, report check status, and stop. The user reviews and merges through GitHub.

# PR feedback (Greptile)

Greptile reviews every PR and re-reviews on each push (`triggerOnUpdates` in
`.greptile/config.json`). To address its feedback, use the `greptile-review` skill
(`.agents/skills/greptile-review/SKILL.md`). Policy:

- Collect ALL unresolved comments before fixing; batch fixes into ONE push per round — never one push per comment.
- Run lint, typecheck, tests and build locally before every push.
- Maximum 3 fix → push → re-review rounds, then stop and report. If Greptile contradicts a previous fix, flag it instead of oscillating.
- Ambiguous or incorrect comments: ask the user or reply on the thread — do not change code to satisfy a bad comment.
