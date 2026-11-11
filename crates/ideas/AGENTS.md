# ideas

## What it is

Suggestions: each person's feed of proactive suggestions (a prompt to run, a
note about specific items, or a routine suggestion), written and managed by
hidden generation sessions through `macro.suggestions.*` tools, and read and
acted on by the person. Served by the harness under the scheduler's gateway
prefix (`/scheduled-action/suggestions`); its OpenAPI is merged into the
scheduler's spec.

Naming: the feature was first called Ideas. Everything outside this crate's
code says suggestion: the tables (`suggestion`, `suggestion_prompt`,
`suggestion_entity`, `suggestion_routine` pointing at `routine_suggestion`,
`suggestion_target`), the routes and their schemas, the SDK
(`macro.suggestions`, `Suggestion`) and the `enable-suggestions` flag. The
crate and its Rust types keep the `idea` name; a routine suggestion is still
its own `routine_suggestion` row, which a `routine` suggestion points to.

## How it works

- A generation session calls `review` (every idea, open or not, with limits),
  then `suggest` (add, or update the idea with the same `dedupKey`), `rewrite`
  and `retire`. Only the person's open `ideas` session in
  `suggestion_generation_session`, found from the request's code-mode
  invocation (`RequestSessions`), may call them; others get 403.
- Code only validates (`domain/check.rs`), stores and logs. Ranking, wording and
  when an idea stops mattering are the session's call; a refused write answers
  `{ ok: false, problems }` the session can act on. Keep it that way: no
  reconciliation, auto-retire or scoring code here.
- Every accepted write adds a `suggestion_change` row (old and new values and
  the session's reason). Changes are silent to the person.

## Start here

- `src/domain/service.rs`: the tools' rules (kind never changes, a dismissed
  idea needs a `reason` to come back, 30 open and 12 new per generation).
- `src/outbound/pg_idea_repo.rs`: base row plus one child table per kind;
  limits are checked under a per-person advisory lock.

## Scope

- Owns: `idea`, `idea_prompt`, `idea_entity`, `idea_routine`, `idea_target`,
  and its `suggestion_change` rows.
- Not here: generation runs and their sessions (they write
  `suggestion_generation*`); routine suggestions → `crates/scheduled_action`.

## Checks

- `cargo test -p ideas` (live DB, `SQLX_OFFLINE` unset).
- After an API change: regenerate the scheduler's spec and clients (see the
  `add-sdk-endpoint` skill); SDK methods live in `packages/sdk/src/entities/suggestions`.

## Gotchas

- Gate every entry point on `enable-suggestions` (`IDEAS_FLAG`).
- Deleting a kind's row (for instance a routine suggestion cascading into
  `idea_routine`) deletes its idea by trigger; reads skip and log a row that
  doesn't decode instead of failing the person's whole feed.
- Texts are checked with `crates/shown_text`: items are named by target, never
  copied into words.
