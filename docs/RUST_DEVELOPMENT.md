# Rust development

Read this for backend changes in `crates/`, `services/`, or Rust tooling.
Return to the [repository guide](../AGENTS.md) for other task guides.

## Before editing

- Read the Rust section of the [style guide](STYLE_GUIDE.md). It owns the coding
  rules, including configuration, errors, tracing, public docs, and test layout.
- Follow the [hexagonal architecture skill](../.agents/skills/cloud-storage-hexagonal-architecture/SKILL.md)
  before changing backend Rust. Keep domain policy and authorization in domain
  services; inbound adapters call services and outbound adapters implement ports.
- Find the owning crate before adding logic. Do not grow catch-all crates or
  bypass the owning domain's APIs with direct database access.
- For queries, migrations, or SQLx failures, use [database development](DATABASE_DEVELOPMENT.md).

## Environment

Run commands from the repository root inside `nix develop`, unless a guide says
otherwise. Nix supplies Cargo, the Rust toolchain, `just`, SQLx, and the other
build tools; see [local prerequisites](RUNNING_LOCALLY.md#shared-prerequisites).

Database-backed tests need running local Postgres (and Redis where used).
Crates with compile-time SQLx macros may need Postgres even to compile their
unit tests. Standalone pure-logic crates need no database setup.

- **Local machine:** use the database guide for test infrastructure, or
  [running locally](RUNNING_LOCALLY.md#run-the-local-stack) for the full product.
- **Cursor Cloud:** use [the Cloud entry points](CURSOR_CLOUD.md), not the local
  stack TUI. Run `bash .cursor/infra.sh` before DB-backed tests.

## Build and check

| Command | Purpose |
| --- | --- |
| `cargo build -p <package>` | Build the affected Cargo package. |
| `just build` | Build with the workspace's default Cargo selection, using the SQLx cache. |
| `just rust-check` | Type-check the Rust workspace using the SQLx cache. |
| `cargo fmt` | Format Rust code. |
| `just check` | Fast, change-scoped format/lint/code-rule gate; not a type check or test runner. |
| `just check full` | Add TypeScript checking and Rust clippy to the gate. |
| `just clippy` | Run workspace Rust lints using the SQLx cache. |

`SQLX_OFFLINE=true` is allowed for `cargo check`, `cargo build`, and `cargo clippy`
when the cache is current. Do not export it for a session that will run tests.

For deployable Lambda artifacts, use `just build_lambdas` or the relevant
service's build recipe, e.g. `just services/document_text_extractor/build`.
Use `just --show <recipe>` to check prerequisites; do not assume all Lambdas
have the same build requirements.

Command definitions live in [rust.just](../tooling/just/rust.just) and
[check.just](../tooling/just/check.just).

## Test the affected packages

Use the package name from the affected `Cargo.toml`, not a guessed spelling of
its directory name. Run each affected package's tests before committing:

```bash
unset SQLX_OFFLINE
cargo test -p <package>
```

There is no root `just test` recipe. Tests use the live local schema, not offline
query metadata. If a test reports missing SQLx cache data, follow the
[database troubleshooting workflow](DATABASE_DEVELOPMENT.md#troubleshooting);
do not enable offline mode to work around it.

Keep tests in a sibling `test.rs` (CS-49). For example, `src/user.rs` declares:

```rust
#[cfg(test)]
mod test;
```

The tests themselves live in `src/user/test.rs` and can use `use super::*;`.
A file module can coexist with its directory; do not convert `user.rs` to
`user/mod.rs` just to add tests.

Update regression tests for changed behavior, including allow/deny cases for
authorization changes. Run relevant tests between batches of query changes and
refresh SQLx metadata as directed by the database guide. If you cannot run a
check, report the command and blocker rather than treating it as passed.
