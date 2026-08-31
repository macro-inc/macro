# Macro

Macro is a SolidJS + Rust workspace for email, messages, docs, tasks, agents, and CRM.
Backend lives in `crates/` and `services/`. The product UI is `apps/web`.

- `apps/web` — SolidJS app
- `crates/`, `services/` — Rust workspace
- `packages/` — shared TypeScript (SDK, lexical)

Keep this file brief. Put task-specific guidance behind a pointer.

## Gotchas

- Navigate with `\cd`, not `cd`.
- `just test` does not exist. From the repo root, `cargo test -p <crate>` with `SQLX_OFFLINE` unset. `SQLX_OFFLINE=true` is only for `cargo check` / `build` / `clippy`.
- After SQL changes, `just prepare_db` from the repo root inside `nix develop`. Never hand-edit `.sqlx/`.
- New migrations: `sqlx migrate add <name>` in the db crate. Do not invent timestamps.
- Some MacroDB names are camelCase. Cast to snake_case when reading (`SELECT "userId" AS user_id`).
- Rust tests live in `foo/test.rs` beside `foo.rs`, not in an inline `#[cfg(test)]` module.
- PR titles are `type(scope): short description`. Squash-merge uses the title as the commit.

## Guardrails

- Load env through `macro_env_var`. Add new vars in Doppler.

## Database

Schema dump: `.claude/skills/dump-schema/SKILL.md`.
MacroDB reset, `prepare_db`, or crate SQL tests: `docs/CLOUD_STORAGE.md`.

## Testing

Crate or SQL tests: `docs/CLOUD_STORAGE.md`.
Frontend: `apps/web/AGENTS.md`.

## Style

Rust or frontend conventions: `docs/STYLE_GUIDE.md`.

## Pull Requests

Opening or titling a PR: `CONTRIBUTING.md`.

## Hexagonal

Changing `crates/` or Rust services: `.claude/skills/cloud-storage-hexagonal-architecture/SKILL.md`.

## Run

Laptop local stack or frontend against hosted services: `docs/RUNNING_LOCALLY.md`.
Cursor Cloud or seeing UI edits there: `.claude/skills/run-app/SKILL.md`.
