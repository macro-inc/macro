# T001: Cargo dependency boundary check

## Goal

Make the Macro Connect boundary complete for Rust: a check that fails when a
crate under `connect/` depends on a Macro workspace crate, or when a Macro
crate depends on any Connect crate other than `connect_client`. The ast-grep
rules (`rules/ast-grep/rust-connect-*.yml`) only catch common crate names;
this check is the authoritative one.

## Context

- `connect/AGENTS.md` (Boundary).
- `tooling/xtask/`: `cargo x <cmd>` subcommands; `xtask_graph` builds the
  guppy `PackageGraph`; `xtask_deps` is the closest model (CI:
  `.github/workflows/cargo_workspace_dependency_check.yml`).

## Do

1. Add the rule to the workspace dependency check run by `cargo x deps --check`
   (new module in `xtask_deps`, or a new `xtask_*` crate wired the same way if
   that is cleaner): for every workspace package and each of its workspace
   dependencies (normal, dev, and build):
   - a package whose manifest is under `connect/` may depend only on packages
     under `connect/` (and `workspace-hack`, which hakari manages);
   - a package outside `connect/` may depend on a package under `connect/`
     only if that package is named `connect_client`;
   - every package under `connect/` is named `connect_*`.
2. Report every violation in one run: `<package> -> <dependency>: <reason>`.
3. Put the rule logic in a pure function over (package name, manifest path,
   dependencies) and unit-test it: allowed and forbidden edges both ways, the
   `workspace-hack` exemption, the naming rule.
4. Make sure CI runs it: if `cargo x deps --check` already runs on every Rust
   change, extending it is enough; otherwise widen the workflow's path filters
   to include `connect/**` and `**/Cargo.toml`.
5. Update `connect/AGENTS.md` Checks (replace "Cargo dependency check ... added
   with the first crate" with the real command) and the `tooling/xtask`
   AGENTS.md if it lists subcommands.

## Done when

- `cargo x deps --check` passes on the current workspace (no `connect/` crates
  exist yet, so zero violations).
- The new unit tests pass: `cargo nextest run -p <crate>`.
- `just check` passes.

## Out of scope

Creating any `connect_*` crate; changing ast-grep rules.

## Result

Implemented the Cargo boundary check in
`tooling/xtask/crates/xtask_deps/src/boundary.rs` and its unit tests in
`tooling/xtask/crates/xtask_deps/src/boundary/test.rs`; wired it through
`tooling/xtask/crates/xtask_deps/src/main.rs`. Updated the workflow
source in
`tooling/xtask/crates/xtask_workflows/src/workflows/cargo_workspace_dependency_check.rs`
and regenerated `.github/workflows/cargo_workspace_dependency_check.yml` so
Connect changes and all Cargo manifests trigger the CI check. Updated
`connect/AGENTS.md` Checks and the `.cargo/config.toml` command description.
Updated `connect/STATUS.md` with the commit blocker.

Checks (all Rust and repo tooling ran inside `nix develop` with
`CARGO_TARGET_DIR="$CONNECT_CARGO_TARGET_DIR"`):

| Check | Outcome |
| --- | --- |
| `cargo nextest run -p xtask_deps` | Passed: 5/5 tests. |
| `cargo x deps --check` | Passed: no boundary violations or artifact drift. |
| `just check` | Passed: `OK`. |
| `cargo x workflows --check` | Passed: generated workflows up to date. |
| `cargo fmt --all -- --check` | Passed. |
| `git diff --check` | Passed. |
| `cargo nextest run -p xtask_workflows` (audit) | 80 passed, 2 unrelated CloudKit fixture tests failed: their restricted PATH cannot find `bash` at `build_dmg_on_tag/test.rs:499` in Nix. |
| `just clippy` (audit) | Workspace phase passed; interrupted in the `sync_service` phase after waiting over 90 seconds for a shared build lock. |

Open product questions: none. Commit is blocked: the worktree's Git metadata
is at `/home/eric/Code/macro/.git/worktrees/T001-cargo-boundary`, outside the
writable sandbox. `git add` fails creating `index.lock` there. No commit was
created; the user has been asked to make that metadata writable.
