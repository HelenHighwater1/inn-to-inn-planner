---
name: greptile-review
description: Collect Greptile's review feedback on the current branch's PR and address it in a bounded loop — triage, fix, verify locally, push once per round. Use when asked to address Greptile/PR review comments, fix review feedback, or respond to a Greptile review.
argument-hint: "[PR number — defaults to current branch's PR]"
---

# Greptile Review Loop

Address Greptile's feedback on a PR in a bounded loop. Maximum **3 rounds** of
fix → push → re-review, then stop and report — no exceptions.

## 1. Locate the PR

```bash
gh pr view --json number,headRefName,url
```

Use the argument as the PR number if given. If no PR exists for the branch,
stop and say so — do not create one.

## 2. Collect ALL feedback before changing anything

Greptile posts via `greptile-apps[bot]` (older installs may differ — always
filter on the substring `greptile`, case-insensitive). It uses three channels;
check all of them:

```bash
# Inline review comments
gh api repos/{owner}/{repo}/pulls/{N}/comments --paginate \
  --jq '.[] | select(.user.login | test("greptile"; "i")) |
        {id, path, line, body, in_reply_to_id, created_at, position}'

# Review summary bodies
gh api repos/{owner}/{repo}/pulls/{N}/reviews --paginate \
  --jq '.[] | select(.user.login | test("greptile"; "i")) |
        {id, state, submitted_at, body}'

# Top-level conversation comments
gh api repos/{owner}/{repo}/issues/{N}/comments --paginate \
  --jq '.[] | select(.user.login | test("greptile"; "i")) | {id, body, created_at}'
```

Notes:

- Review comments with `"position": null` are outdated — the code moved past them. Skip them.
- Skip comment IDs already handled in an earlier round this session.
- For comments inside a thread (`in_reply_to_id` set), read the parent first.

## 3. Triage — do not blindly fix

Classify every item before touching code:

- **Valid** → fix it.
- **Ambiguous, or conflicts with the ticket's intent** → ask the user. Do not guess.
- **Incorrect / false positive** → do NOT change code. Reply on the thread explaining why:

  ```bash
  gh api repos/{owner}/{repo}/pulls/comments/{comment_id}/replies -f body="..."
  ```

Over-applying marginal comments is the main cause of regression churn —
a well-reasoned reply is a valid resolution.

If there are more than ~5 items, or any require judgment, show the triage list
to the user before fixing.

## 4. Fix and verify locally

Make all fixes for the round, then run the same checks CI runs before pushing:

```bash
npm run lint
npx tsc -b
npm test
npm run build
```

Never push code that fails local checks — a broken push wastes a Greptile
review round and a CI run.

## 5. Push exactly once per round

One commit covering all the round's fixes; push to the PR branch.
Per AGENTS.md: never merge the PR, never use `--auto` or `--admin` merge.

## 6. Wait for re-review, then repeat

`triggerOnUpdates: true` in `.greptile/config.json` means every push triggers a
fresh review. Record the latest Greptile `submitted_at` before pushing, then poll
~every 60s until a review newer than that timestamp appears:

```bash
gh api repos/{owner}/{repo}/pulls/{N}/reviews \
  --jq '.[] | select(.user.login | test("greptile"; "i")) | .submitted_at' | sort | tail -1
```

Then return to step 2.

## Stop conditions — any one ends the loop

- Latest Greptile review has no unresolved items → done; report summary.
- 3 rounds completed → stop; list what's still open and hand back to the user.
- A comment needs user judgment → pause and ask; resume after the answer.
- Greptile contradicts a previous round's fix → flag it; do not oscillate.
- Local checks can't go green → stop and report the failure.
