---
name: git
description: Commit, branch, push, and open or update pull requests in this repository. Use before writing a commit message or PR title/body, pushing, stacking PRs, or when asked to "commit", "open a PR", or "push".
---

# Git and pull requests

Commit as you go on a feature branch, one logical change per commit, without
asking. Never commit to `main`. Push or open a PR only when the user asks.

## Branches

`<user>/<topic>` in kebab-case, for example `wolf/agent-rules`. One concern per
branch. For dependent work, stack branches and open one PR per layer, each based on
the branch below it.

Use the user's established branch prefix, not the OS username.

## Commits and PR titles

[Conventional Commits](https://www.conventionalcommits.org): `type(scope): summary`.
The PR title follows the same form; squash merges use it as the commit on `main`.

- **type:** `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `ci`, `build`,
  `chore`. A breaking change adds `!` (`feat!:`) and says what breaks in the body.
- **scope:** the feature or crate a reader would recognise, lowercase:
  `channels`, `crm`, `auth`, `mcp`, `sync-service`. Omit it when the change is
  genuinely repo-wide.
- **summary:** what changes for the user or caller, imperative, lowercase start,
  no trailing period, about 72 characters at most.
  `fix(channels): open conversations without loading their read history`, not
  `fix: update channel loading logic`.
- **body:** why the change was needed and anything a reviewer can't see in the
  diff. Wrap at 72 columns.

## Before pushing

Run what applies to the files you changed, and fix failures before pushing:

```sh
just check                                # format, lint, code rules on changed files
cargo fmt --all -- --check                # any Rust change
cargo x deps --check                      # Cargo.toml or crate added/removed
cargo x workflows --check                 # workflow generators changed
cargo x kafka-topics --check              # macro_event_topics changed
```

GitHub Actions workflows are generated from Rust: edit
`tooling/xtask/crates/xtask_workflows`, never the YAML (see the
[workflows rule](../../rules/infra/github-workflows.md)).

Run the `audit` skill before handing off; it covers tests and area checks.

## PR description

Write for a reviewer who hasn't seen the conversation. Use these sections, in
order, and drop any that would be empty:

```markdown
## Why

The problem or goal, with the evidence: the bug and how it shows up, numbers
measured, the user request. Link issues.

## How it works

A short high-level explanation of the approach, plus an ASCII diagram of the
flow, data shape, or before/after when one helps (cross-service flows, state
machines, pipelines). Drop it for small or mechanical changes.

## What

- One bullet per meaningful change, in reading order. Name files or modules
  when it helps navigation. Call out decisions and alternatives rejected.

## Follow-ups

- Work deliberately left out, with the reason.
```

No test plan or testing section in PR descriptions or commit messages: CI shows
the checks, and what you ran goes in your report to the user. Attach proof for
user-visible changes: screenshots or a recording (see the `record-proof` skill
when it is available).

## Handing off a PR

Open PRs ready for review, not as drafts; if one was created as a draft, mark it
ready. A PR whose checks are failing or still running is not done: watch CI and fix
failures before handing off.

## Updating a PR

Push follow-up commits rather than force-pushing over review history, unless the
user asks for a rebase. When the scope changes, update the title and the What
section to match.
