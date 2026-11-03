# T002: Registry and `connect_registry` crate

## Goal

The Macro Connect catalog exists as data: one directory per day-1 app under
`connect/registry/apps/<id>/` with `app.toml` and `icon.svg`, and a
`connect_registry` crate that loads and validates them so services can serve
the catalog.

## Context

- `connect/docs/catalog.md`: the `app.toml` format and field rules. Follow it
  exactly.
- `connect/docs/research/vendor-auth.csv`: probe results per Pipedream app.
- Prior art with every day-1 entry (id, name, description, MCP URL, Pipedream
  slugs, Linear's scopes):
  `git show eric/macro-connect-registry:crates/mcp_client/src/domain/connect_apps.rs`.
  Mine the data; do not copy its Rust design.
- `connect/AGENTS.md` (Boundary: the crate depends on no Macro crate).

## Do

1. Create `app.toml` for each of the 36 apps in the prior art's `APPS`.
   - `client_registration`: `own_app` for GitHub and Slack (v1 reuses Macro's
     existing apps); otherwise `cimd` when the CSV's `mcp_auth` contains
     `cimd`, else `dcr`.
   - `status = "live"`, `access = ["mcp"]`, `probed = 2026-10-30`.
   - `pipedream_app_slugs` and `scopes` from the prior art.
2. Add `icon.svg` for each app from Simple Icons
   (`https://cdn.jsdelivr.net/npm/simple-icons@<pinned version>/icons/<slug>.svg`),
   unaltered. Where Simple Icons has no icon for the brand, add none and list
   the app in the Result; never draw or invent one.
3. Create crate `connect/crates/connect_registry` (add it to the workspace
   members): types for an app per `catalog.md` (closed sets as enums, ids as a
   validated newtype), and a function returning every app, embedded at compile
   time so services need no registry files at runtime. Library crate rules:
   `#![deny(missing_docs)]`, tests in sibling `test.rs`, `thiserror` errors.
   Depend only on third-party crates from `[workspace.dependencies]`; run
   `just hakari` after editing `Cargo.toml`.
4. Tests that validate the real registry: every `app.toml` parses; ids unique
   and equal to their directory names; each Pipedream slug in at most one app;
   `mcp_url` is https with no trailing slash; `own_app` apps list no scopes
   unless the spec says so; every `live` app has an icon or is in an explicit
   allowlist of apps with no Simple Icons icon (from step 2).
5. Write `connect/crates/connect_registry/AGENTS.md` from
   `.agents/templates/AGENTS.md`, with the sibling `CLAUDE.md` symlink.

## Done when

- `cargo nextest run --all-features -p connect_registry` passes.
- `cargo x deps --check` passes (run `just hakari` first if it reports drift).
- `just check` passes, including the `connect-*` ast-grep rules.

## Out of scope

Any HTTP service or API, the Connect database, changes outside `connect/`
other than the workspace member list and `crates/workspace-hack` from hakari.

## Result

- Added 36 `connect/registry/apps/<id>/app.toml` files from the prior art and
  OAuth probe CSV, plus 27 unaltered `icon.svg` files from Simple Icons
  16.36.0. No Simple Icons icon exists in that release for Apollo, Attio,
  Canva, Granola, Klaviyo, monday.com, Pipedrive, Quo, or Slack.
- Added `connect/crates/connect_registry/{Cargo.toml,AGENTS.md,CLAUDE.md}` and
  `src/{lib.rs,embedded.rs,test.rs}`. The crate embeds the catalog, exposes
  typed app records, and validates ids, slugs, URLs, access, scopes, and icons.
- Updated root `Cargo.toml`, `Cargo.lock`, `crates/workspace-hack/Cargo.toml`,
  `.github/workspace-dep-closures.json`, `connect/AGENTS.md`, `connect/STATUS.md`,
  `connect/docs/{catalog,plan}.md`, and
  `connect/.agents/skills/connect-add-app/SKILL.md`.

Checks:

| Check | Outcome |
| --- | --- |
| `cargo nextest run --all-features -p connect_registry` | Passed: 7 tests. |
| `cargo x deps --check` | Passed after `just hakari`. |
| `CHECK_BASE=HEAD just check` | Passed (`OK`); scoped to this task's worktree changes. |
| `just check` with its default base | Failed: bunx's ast-grep binary cannot launch on NixOS. A separate native Nix ast-grep scan of all new Rust files passed with the repository rules. |
| `just rust-check` | Passed, full workspace. |
| `just clippy` | Passed, full workspace. |
| `just format` and `cargo fmt --all -- --check` | Passed. |
| `just hakari` | Passed on final run; generated dependency artifacts are current. |
| SVG byte comparison against Simple Icons 16.36.0 | Passed: all 27 icons matched. |
| `git diff --check` | Passed. |
| Commit | Blocked: Git metadata is under `/home/eric/Code/macro/.git`, which is read-only in this sandbox (`index.lock`: read-only file system). Changes remain uncommitted. |

Open question: hakari requires a generated `workspace-hack` dependency in
`connect_registry` and changes `Cargo.lock` and
`.github/workspace-dep-closures.json`, while this spec permits only the root
workspace member list and `crates/workspace-hack` outside `connect/`. Should
these generated exceptions be accepted for T002, or should hakari be changed
in a separate task to exclude Connect crates?
