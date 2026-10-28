# Repository guide for coding agents

Macro is a document and collaboration app with a Rust backend and a web frontend.
This file is the shared entry point: `AGENTS.md` symlinks to `CLAUDE.md`. Edit
`CLAUDE.md` and preserve the symlink; do not maintain two copies.

## Start here

Unless the user says otherwise, before writing any code:

1. Read [CODING.md](CODING.md).
2. Find the affected app, service, or crate in the map below and read its
   `AGENTS.md`.
3. Read the task-relevant guides below, not every linked document.
4. Explore the code you will change and its callers until you know how it works.

Rules in `.agents/rules/` load when you touch matching files. Prefer them over
patterns in older code.

## Repository map

| Path | Contents |
| --- | --- |
| `apps/web/` | Web frontend; its own agent guide covers Bun, UI patterns, and browser verification. |
| `apps/`, `packages/` | Other apps and shared frontend packages. |
| `services/` | Deployable services and workers; Rust package names come from each `Cargo.toml`. |
| `crates/` | Reusable backend libraries, domain services, and adapters. |
| `crates/macro_db_client/migrations/` | MacroDB PostgreSQL migrations. |
| `infra/` | Deployment definitions and local infrastructure. |
| `tooling/` | Development tools, scripts, and imported `just` recipes. |
| `docs/` | Development guides, architecture, designs, runbooks, and the browser agent guide; see [the index](docs/README.md). |

## Where agent guidance lives

| Path | Contents |
| --- | --- |
| `CODING.md` | Coding rules for every language; read before writing code. |
| `AGENTS.md` in a directory | Scope, map, checks, and gotchas for that subtree; a sibling `CLAUDE.md` symlinks to it. |
| `.agents/skills/` | Task workflows. `.claude/skills` and `.pi/skills` symlink here. |
| `.agents/rules/` | Path-scoped conventions, loaded when you touch matching files. `.claude/rules` and `.cursor/rules` symlink here. |
| `.agents/agents/` | Subagents (`auditor`, `browser-verifier`). `.claude/agents` symlinks here. |
| `.agents/templates/` | Templates for new rules and `AGENTS.md` files. |
| `rules/ast-grep/` | Mechanically enforced code rules, run by `just check`. |

Real files live in `.agents/`; tool-specific directories only symlink to it.

## Read when relevant

| Task | Guide |
| --- | --- |
| Reusing database storage or separating it from an app entity | [Database core skill](.agents/skills/database-core/SKILL.md) |
| Adding collaborative markdown to a feature | [Collab surface core skill](.agents/skills/collab-surface-core/SKILL.md) |
| Adding a flow or hot path, or tracing one | `instrumentation` skill |
| Rust code, builds, or tests | [Rust development](docs/development/rust.md) |
| SQLx queries, migrations, DB tests, or cache errors | [Database development](docs/development/database.md) |
| Web frontend | [Web agent guide](apps/web/AGENTS.md) |
| iOS App Store releases, breaking Tauri changes, native build floors | [iOS releases](apps/web/docs/ios-releases.md) |
| Android Play releases from pull requests | [Android development](docs/development/android.md) |
| Email body rendering or snapshots | [Standalone renderer](packages/email-renderer/README.md) |
| Running the frontend or backend on a local machine | [Running locally](docs/development/running-locally.md) |
| Giving the user a local preview link | `local-preview` skill |
| Working inside Cursor Cloud | [Cursor Cloud](docs/development/cursor-cloud.md) |
| Driving the app through a browser | [App agent guide](docs/agent-guide/README.md) |
| Adding or changing SDK methods | [SDK rule](.agents/rules/sdk.md), `add-sdk-endpoint` skill |
| SDK version bumps and npm publishing | [SDK release guide](packages/sdk/RELEASING.md), [release-sdk skill](.agents/skills/release-sdk/SKILL.md) |
| Adding a service, worker, or Pulumi stack | [New service guide](docs/guides/new-service.md) |
| Infrastructure, Pulumi, or deploys | [Infrastructure guide](docs/development/infrastructure.md) |

## Rules

**Working with the user**

- Do only what was asked. Questions get answers, not code changes.
- Commit as you go, in small logical commits on a feature branch, without
  asking. Never commit to `main`. Push or open a PR only when asked.
  Once authorized, finish in-scope review fixes and follow-up pushes without
  per-fix confirmation.
- Flag real risks; once the user decides, act on it.
- Disagree when they're wrong. No flattery.
- Answer simple questions directly.
- For UI work, ask how it should behave on mobile unless that's obvious.
- Ground UI proposals and prototypes in the existing Macro app screens and
  design system, preserving its shell, typography, controls, and spacing.
- Treat an approved UI proposal followed by a PR request as a request to
  implement it; keep standalone prototypes outside the repository unless asked.
- Be brief. No justification essays, no time estimates.

**Environment**

- Never touch production (data, services, consoles, secrets) without explicit
  permission.
- Never deploy (`pulumi up`, `wrangler deploy`, workflow dispatch) without
  explicit permission for that deploy.
- Never reset databases or wipe stack volumes without approval.
- Never paste or commit secrets.
- Never `git stash`; it's shared across sessions.
- Memory is context, not authority; verify against code.
- Treat hosted dev data as real. `.cursor/*.sh` is Cursor Cloud only.
- Use `\cd` instead of `cd`.

## Before handing off

- Commits, branches, and PRs follow the `git` skill: Conventional Commit titles
  such as `fix(onboarding): preserve team inputs`, and Why / What bodies with no test plan.
- Run the `audit` skill (via the `auditor` subagent) before saying work is done.
- Update every doc your change makes stale, in the same change: the `AGENTS.md`
  of each directory you touched, `docs/guides/`, `docs/architecture/`, the
  agent guide, READMEs, rules, and skills. Search for the names you changed.
- A new crate, service, or package gets an `AGENTS.md` from the
  [template](.agents/templates/AGENTS.md); one you change keeps its `AGENTS.md`
  current. Add the sibling symlink (`ln -s AGENTS.md CLAUDE.md`) so Claude Code
  reads it too.
- Open pull requests ready for review. If one is created as a draft, mark it
  ready for review before handing off.
- Get CI passing before handing off. A pull request whose checks are failing
  or still running is not done.
- Test the affected packages/services individually before committing. Use the
  relevant guide for setup; there is no root `just test` recipe.
- For code changes, run `just check` (format/lint/code rules scoped to changes).
  `just check full` adds TypeScript checking and Rust clippy; `just rust-check` is
  the workspace Rust type check. These checks do not replace tests.
- Exercise user-visible changes in a browser. If routes, creation flows, editors,
  AI surfaces, or composer behavior change, update the corresponding
  [app agent guide](docs/agent-guide/README.md) in the same change.
- Report what you tested and any checks blocked by the environment.

## Keeping guidance current

Update the docs in the same change whenever:

- the user gives feedback that applies beyond the current task,
- you and the user settle on a new convention or reverse an old one,
- you find a doc, rule, or guide that is wrong or stale.

Put it in exactly one place, the narrowest that fits:

| Kind of guidance | Goes in |
| --- | --- |
| How to behave with the user, or a cross-cutting guardrail | This file, **Rules** |
| A coding rule for every language | `CODING.md` |
| A convention for certain paths (Rust, web, DB, infra) | `.agents/rules/<area>/`, from the [rule template](.agents/templates/rule.md) |
| Something checkable by a tool | An ast-grep rule in `rules/ast-grep/` or a lint, instead of prose |
| Navigation, recipes, or gotchas for one directory | That directory's `AGENTS.md`, from the [template](.agents/templates/AGENTS.md) |
| A repeatable multi-step task | A skill in `.agents/skills/` |
| An end-to-end walkthrough of a change | `docs/guides/` |
| How a system works | `docs/architecture/` |

How:

- Edit the existing entry before adding a new one; delete what the change makes
  wrong. Never leave two versions of the same rule.
- Write the rule as one imperative line, with the reason only when it isn't
  obvious. ID-bearing rules take the next free number.
- Keep this file short: rules and links, no journals, command lists, or runbooks.
- Tell the user which doc you changed and how, in one line.
