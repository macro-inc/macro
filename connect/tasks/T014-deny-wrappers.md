# T014: Pass cargo-deny: Connect's platform crate wraps AWS config and tracing

Base: `eric/macro-connect` (PR #9231). CI's `cargo-deny` fails.

## Goal

`cargo deny check bans` passes. `deny.toml` bans direct use of `aws-config`
and `tracing-subscriber` outside named wrapper crates (Macro's are
`macro_aws_config` and `macro_entrypoint`). Connect can't use Macro's, so
`connect_platform` is Connect's wrapper for both.

## Do

1. Move AWS SDK config loading out of `connect_api` into `connect_platform`
   (a small function like `macro_aws_config`'s, behind no new feature unless
   needed), and have `connect_api` build its KMS client from it. Only
   `connect_platform` depends on `aws-config`.
2. Add `connect_platform` to the `wrappers` lists for `aws-config` and
   `tracing-subscriber` in `deny.toml`, with a comment: Connect's platform
   crate (Connect may not depend on Macro's wrappers).
3. `just hakari` if `Cargo.toml` changes.

## Done when

- `cargo deny check bans` passes locally (install with `cargo install
  cargo-deny --locked` inside `nix develop` if missing, or use the version the
  workflow pins).
- `cargo nextest run --all-features -p connect_api -p connect_platform`,
  clippy (`-D warnings`), `cargo x deps --check`, `just check` pass.

## Out of scope

Anything else.

## Result

Changed:

- `connect/crates/connect_platform/src/lib.rs` loads the default AWS SDK config;
  `connect/services/connect_api/src/main.rs` uses it to construct the KMS client.
- The two crate `Cargo.toml` files and `Cargo.lock` move the direct `aws-config`
  dependency from `connect_api` to `connect_platform`.
- `deny.toml` allows `connect_platform` as the AWS config and tracing subscriber
  wrapper. `connect/crates/connect_platform/AGENTS.md` documents its AWS role.

Checks:

- `just hakari` — passed; refreshed `Cargo.lock`.
- `cargo deny check bans` — passed (`bans ok`; existing workspace warnings).
- `cargo nextest run --all-features -p connect_api -p connect_platform` — passed:
  28 tests, 0 skipped.
- `cargo clippy -p connect_api -p connect_platform --all-features --all-targets -- -D warnings`
  — passed.
- `cargo x deps --check` — passed.
- `just check` — passed (format, ast-grep rules, PII scan, and 12 scanner tests).
- `cargo fmt --all -- --check` and `git diff --check` — passed in the audit.
- Audit — passed; no remaining findings.

Open questions: None.

Proposed commit:

```text
fix(connect): load AWS config through platform wrapper

Why:
Direct AWS configuration in the API violates the dependency wrapper ban.

What:
Move AWS SDK configuration loading into connect_platform and use it for
the API's KMS client. Register Connect's platform wrapper in cargo-deny
and update the dependency artifacts and crate guide.
```
