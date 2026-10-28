---
name: git
description: Read this before any git or GitHub operation. Use whenever you commit, branch, rebase, push, or open or update a pull request — including writing a commit message or PR title/body. Never include customer PII or secrets in commits, messages, or PR descriptions.
---

# Git and pull requests

Commit as you go on a feature branch, one logical change per commit, without
asking. Never commit to `main`. Push or open a PR only when the user asks.

## PII and secrets

Never put customer or third-party PII, or secrets, in a commit, commit
message, PR title, or PR description. That includes emails, phone numbers,
physical addresses, API keys, and tokens. Refer to people as "the customer"
or a placeholder (`customer@example.com`).

The pre-commit hook scans staged added lines. Do not skip it (`--no-verify`).
Do not add lines to `tooling/pii/exceptions` unless a human asks you to.

Before opening or updating a PR, reread the title and body and strip any PII
that came from logs, traces, or production data. `python3 tooling/pii/scan.py
--text -` reads a title or body from stdin; `--changed` is what `just check` runs.

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

## Privacy

Everything written into the repository or onto GitHub is public: PR titles and
bodies, commit messages, review comments and replies, code comments, docs, and
test fixtures. Describe the code change and nothing else.

- Never include personal data: names, emails, phone numbers, usernames,
  addresses, account or workspace ids of real users, or @mentions of people.
- Never name customers, prospects, partners, their companies, or their
  products. Name a third-party product only when the code integrates with it
  (`Slack integration`), never as the source of a request or report.
- Never cite support channels, tickets, chat channels or threads, calls,
  meetings, emails, or links into support tools or Macro workspace items
  (task links are fine). Don't say who asked or where it was reported.
- Never mention places tied to a person or customer (cities, offices, regions).
- When the reason matters, say it in general terms: "Users with long read
  histories saw channels load slowly", not "<customer> reported in
  <channel> that…". "A user request" is enough; omit the requester.
- Test fixtures and examples use placeholders (`user@example.com`, `Acme`),
  never data copied from a real account or conversation.
- Context the user gives you (a support thread, a customer name, a screenshot)
  stays in the conversation; restate it as the general problem before writing.

CI's `PR Privacy Check` fails a PR whose title, body, or commits contain
emails, phone numbers, @mentions, chat-channel names, or support-tool and Macro
workspace links (Dependabot PRs are exempt). It cannot see names, so passing it
is not enough: reread every title, body, and message against the list above.
Run it locally before pushing or opening a PR:

```sh
just pr-privacy                                   # commit messages on this branch
PR_TITLE="fix(x): ..." just pr-privacy body.md    # plus the PR title and body you will post
```

To fix a hit, edit the PR title or body, or reword the commit on your branch.

## Before pushing

Run what applies to the files you changed, and fix failures before pushing:

```sh
just check                                # format, lint, code rules on changed files
just pr-privacy                           # commit messages carry no personal details
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
measured. Link GitHub issues or Macro tasks. Follow the Privacy section above.

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
