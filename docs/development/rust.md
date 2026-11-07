# Rust development

Read this for backend changes in `crates/`, `services/`, or Rust tooling.
Return to the [repository guide](../../AGENTS.md) for other task guides.

## Before editing

- The Rust rules in [`.agents/rules/rust/`](../../.agents/rules/rust/) own the coding
  conventions, including errors, tracing, public docs, and test layout; the
  [config rule](../../.agents/rules/config-and-service-urls.md) owns configuration.
- Follow the [hexagonal architecture skill](../../.agents/skills/cloud-storage-hexagonal-architecture/SKILL.md)
  before changing backend Rust. Keep domain policy and authorization in domain
  services; inbound adapters call services and outbound adapters implement ports.
- Find the owning crate before adding logic. Do not grow catch-all crates or
  bypass the owning domain's APIs with direct database access.
- For queries, migrations, or SQLx failures, use [database development](database.md).

## Crates and dependencies

- Add a new crate to the root `Cargo.toml` `members` list (one per line, sorted),
  then run `just hakari` (`cargo x deps`). It gives every crate another member
  depends on a root `[workspace.dependencies]` entry at its current path, drops
  entries nothing uses, and rewrites relative `path = "../x"` dependencies
  between members to `x = { workspace = true }`. A crate's first dependent can
  write a relative path; the command turns it into a root entry. Moving a crate
  needs only its `members` line changed; the same command updates the root
  entry. CI fails when the manifests drift from that.
- hakari owns the `workspace-hack = { version = "0.1", path = "../workspace-hack" }`
  lines; leave them as it writes them.
- A root entry with `default-features = false` turns defaults off for every
  dependent; dependents that need them say `default-features = true`.

## Environment

Run commands from the repository root inside `nix develop`, unless a guide says
otherwise. Nix supplies Cargo, the Rust toolchain, `just`, SQLx, and the other
build tools; see [local prerequisites](running-locally.md#shared-prerequisites).

Database-backed tests need running local Postgres (and Redis where used).
Crates with compile-time SQLx macros may need Postgres even to compile their
unit tests. Standalone pure-logic crates need no database setup.

- **Local machine:** use the database guide for test infrastructure, or
  [running locally](running-locally.md#run-the-local-stack) for the full product.
- **Cursor Cloud:** use [the Cloud entry points](cursor-cloud.md), not the local
  stack TUI. Run `bash .cursor/infra.sh` before DB-backed tests.

## Build and check

| Command | Purpose |
| --- | --- |
| `cargo build -p <package>` | Build the affected Cargo package. |
| `just build` | Build with the workspace's default Cargo selection, using the SQLx cache. |
| `just rust-check` | Type-check the Rust workspace using the SQLx cache. |
| `cargo fmt` | Format Rust code. |
| `just check` | Fast, change-scoped format/lint/code-rule/PII gate; not a type check or test runner. |
| `just check full` | Add TypeScript checking and Rust clippy to the gate. |
| `just clippy` | Run workspace Rust lints using the SQLx cache. |
| `cargo shear` | Find unused dependencies from source, without compiling (CI and `just check` run it). `cargo shear --fix` removes them; list a dependency needed only for a side effect (feature activation, linking) in its manifest's `[package.metadata.cargo-shear] ignored` with a comment. `cargo udeps` is the slower, compile-based cross-check. |

`SQLX_OFFLINE=true` is allowed for `cargo check`, `cargo build`, and `cargo clippy`
when the cache is current. Do not export it for a session that will run tests.

For deployable Lambda artifacts, use `just build_lambdas` or the relevant
service's build recipe, e.g. `just services/document_text_extractor/build`.
Use `just --show <recipe>` to check prerequisites; do not assume all Lambdas
have the same build requirements.

The dev profile builds workspace crates incrementally with line-table debuginfo
and dependencies without debuginfo, which keeps edit-to-binary rebuilds short.
Backtraces keep file and line for workspace code. For a debugger, pass
`--config 'profile.dev.debug="full"' --config 'profile.dev.package."*".debug="full"'`.
Gate wasm-only features such as `uuid/js` on
`[target.'cfg(target_arch = "wasm32")'.dependencies]`: enabled natively, they
change the feature set of a shared dependency and rebuild everything above it
whenever you switch between services.

Command definitions live in [rust.just](../../tooling/just/rust.just) and
[check.just](../../tooling/just/check.just).

## Crate layers

[`.config/layers.toml`](../../.config/layers.toml) puts every workspace crate
in a layer (`types`, `platform`, `aws`, `clients`, `engines`, `client`,
`domain`, `graphql`, `testing`, `services`, `tooling`) by directory glob, and
says which layers each may depend on. `cargo x deps` (and CI's
`cargo x deps --check`) prints the report after regenerating the dependency
artifacts. It is report-only: nothing fails on a violation yet.

- **New crate:** if the report lists it as `unassigned`, add its directory to
  the layer it belongs in. A crate directory under a group (`crates/types/`,
  `crates/email/email/`, …) is placed by that group's glob.
- **`violation`:** a normal or build dependency from one layer into a layer it
  may not use. Cut the edge (move the shared types down into a `types` crate,
  or construct the adapter in the composition root). If the edge must stay for
  now, add an `[[allow]]` with `from`, `to` (package names) and a `reason`.
- **`stale allow`:** the edge is gone; delete the `[[allow]]` entry.
- **`unmatched path`:** a literal path names a crate that moved or was
  removed; update it.

Dev-dependencies are exempt, except that only dev-dependencies may point at
the `testing` layer.

## Test the affected packages

Use the package name from the affected `Cargo.toml`, not a guessed spelling of
its directory name. Run each affected package's tests before committing:

```bash
unset SQLX_OFFLINE
cargo test -p <package>
```

There is no root `just test` recipe. Tests use the live local schema, not offline
query metadata. If a test reports missing SQLx cache data, follow the
[database troubleshooting workflow](database.md#troubleshooting);
do not enable offline mode to work around it.

CI runs `test` and `check` on a 32 vCPU, 64 GiB runner with no build job limit.
Don't lift the job limit on the 8 vCPU, 16 GiB runner by itself: linking many
large test binaries exhausts its memory and can lose the runner.

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
