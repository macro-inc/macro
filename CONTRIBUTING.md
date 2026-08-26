# Contributing to Macro

Thanks for your interest in contributing! Macro is fully open source under the
[AGPLv3](LICENSE.txt), and we welcome outside contributions. This guide covers
how to get a change from idea to merged PR.

## Start with an issue

Open an issue before putting up a PR. This applies to both features and fixes. It lets us confirm the change is wanted and agree on an approach before you invest time into it. PRs that show up without a linked issue may be closed.

## AI-assisted contributions

Useful contributions require human effort. You may use whatever tools best
serve you including AI tools, but if you don't understand the work you're
doing it's probably not useful.

You should:

- Understand the changes and decisions you made well enough to answer questions in review.
- See your change working in a local development environment

Unreviewed AI output submitted as-is wastes reviewer time and will be closed.

## Conventions

We use semantic (Conventional Commits) naming for branches and PR titles:

```
feat(chat): add dev observability
fix(email): handle empty thread subjects
```

- **PR title:** `type(scope): short description` this becomes the commit
  message on merge, so make it accurate.
- **Branch name:** same idea, slash-separated, e.g. `feat/chat-dev-observability`.

Common types: `feat`, `fix`, `chore`

## PR bodies

Keep PR bodies concise and write them yourself. A few sentences covering what
changed and why, a link to the issue, and anything a reviewer needs to know.
No generated boilerplate, no exhaustive file-by-file change lists.

## Development setup

You do not need the local stack if you only change the frontend.

If you only change the frontend, run the [frontend against hosted services](docs/RUNNING_LOCALLY.md#run-the-frontend-against-hosted-services).

If you change a backend service, the database, or behavior that must stay on your machine, [run the local stack](docs/RUNNING_LOCALLY.md#run-the-local-stack).

## Before you push

- Follow the [style guide](docs/STYLE_GUIDE.md).
- Format and lint: `cargo fmt` and `just clippy` for Rust changes.
- Run the tests for the crates you touched: `cargo test -p <crate>`.
- If you changed SQL queries or migrations, run `just prepare_db` from the
  repository root to refresh the sqlx cache.

## Contributor License Agreement

Before we can merge a PR from outside the macro-inc GitHub org, you need to
have signed the Macro CLA. It's a one-time signature that covers all your
future contributions:

1. Every PR runs a required check named `cla`. If you haven't signed, it
   shows red — that's expected and doesn't block review.
2. Sign at **<https://macro-cla.macroverse.workers.dev/cla>** ("Sign with
   GitHub"; we request no OAuth scopes, only your public identity).
3. Comment `/macro-cla check` on your PR and the check re-runs and goes
   green.

macro-inc org members are exempt (employee agreements already cover their
contributions), as are bot accounts like Dependabot.

## License

By contributing, you agree that your contributions will be licensed under the
[AGPLv3](LICENSE.txt), the same license that covers the project.
