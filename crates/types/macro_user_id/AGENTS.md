# macro_user_id

## What it is

Shared infrastructure: the identity type used across the whole backend. The
`MacroUserId` newtype (`macro|<email>`) and its `nom`-based parser —
parse-don't-validate for the single most widely used identity type in the
backend.

## Start here

- `src/user_id.rs` (+ `src/user_id/tests.rs`): `MacroUserId<T>` — generic over
  its string storage (`cowlike::CowLike`), parsed with `nom`.
- `src/email.rs` (+ `src/email/tests.rs`): the email-part parser and `Email<T>`.
- `src/lowercased.rs`: case-normalization wrapper used for lookups/comparisons.
- `src/error.rs`: `ParseErr`.

## Scope

- Owns: parsing and representing the `macro|<email>` user id shape.
- Not here: resolving a user id to a user record (MacroDB) — that's
  `macro_db_client`/the owning domain crate.

## Boundaries

- Depends on: `cowlike` (generic Cow-like string storage), `doppleganger`,
  `nom`.
- Used by: essentially everywhere a user id crosses a function
  boundary; a change to the parser or `Debug`/`PartialEq` semantics is
  widely felt.

## Checks

- `cargo test -p macro_user_id` (`SQLX_OFFLINE` unset).

## Gotchas

- `MacroUserId::eq` only compares the underlying string (`user_id`), not the
  derived email offsets — don't add fields to the struct without checking
  whether `PartialEq`/`Debug` need to account for them.
- `features = ["sqlx"]` / `["schema"]` are additive, feature-gated impls
  (`sqlx::Type`, `utoipa::ToSchema`) — most callers only need the default.

## Related

- Rules: `.agents/rules/rust/code.md` (CS-10 newtype ids)
