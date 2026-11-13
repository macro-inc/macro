# suggestions

## What it is

Suggestions: each person's feed of proactive suggestions (a prompt to run, a
note about specific items, or a routine suggestion), written and managed by
hidden generation sessions through `macro.suggestions.*` tools, and read and
acted on by the person. Served by the harness under the scheduler's gateway
prefix (`/scheduled-action/suggestions`); its OpenAPI is merged into the
scheduler's spec.

## How it works

- A generation session calls `review` (every suggestion, open or not, with limits),
  then `suggest` (add, or update the suggestion with the same `dedupKey`), `rewrite`
  and `retire`. Only the person's open `suggestions` session in
  `suggestion_generation_session` (`GenerationSessions`), found from the
  request's code-mode invocation (`RequestSessions`), may call them; others
  get 403. Reading the feed with `?timezone=` counts the person in for
  nightly generations (`SuggestionAudience`).
- A generation session ends by having each suggestion it wrote checked against its
  cited items: its last programs call `macro.ai.structuredCompletion` (tool
  free) on the model `SuggestionService::with_checker_model` names, which sees only
  the suggestion and the items' text and lists what the items don't state; the
  session rewrites those suggestions. This lives in the brief (`domain/prompt.md`),
  not in code. The calls are the hidden session's, recorded non-billable.
- Code only validates (`domain/check.rs`), stores and logs. Ranking, wording and
  when a suggestion stops mattering are the session's call; a refused write answers
  `{ ok: false, problems }` the session can act on. Keep it that way: no
  reconciliation, auto-retire or scoring code here.
- Every accepted write adds a `suggestion_change` row (old and new values and
  the session's reason). Changes are silent to the person.

## Start here

- `src/domain/service.rs`: the tools' rules (kind never changes, a dismissed
  suggestion needs a `reason` to come back, 30 open and 12 new per generation).
- `src/outbound/pg_suggestion_repo.rs`: base row plus one child table per kind;
  limits are checked under a per-person advisory lock.

## Scope

- Owns: `suggestion`, `suggestion_prompt`, `suggestion_entity`,
  `suggestion_routine`, `suggestion_target`, and its `suggestion_change` rows.
- Also: the vocabulary every generation's tools share (`GenerationTrigger`,
  `SessionKind`, `GenerationSession`) and the `GenerationSessions` and
  `SuggestionAudience` ports, which `crates/suggestion_generation` implements;
  the suggestions session's brief (`domain/prompt.md`).
- Not here: generation runs and their sessions → `crates/suggestion_generation`;
  routine suggestions → `crates/scheduled_action`.

## Checks

- `cargo test -p suggestions` (live DB, `SQLX_OFFLINE` unset).
- After an API change: regenerate the scheduler's spec and clients (see the
  `add-sdk-endpoint` skill); SDK methods live in `packages/sdk/src/entities/suggestions`.

## Gotchas

- Gate every entry point on `enable-suggestions` (`SUGGESTIONS_FLAG`).
- Deleting a kind's row (for instance a routine suggestion cascading into
  `suggestion_routine`) deletes its suggestion by trigger; reads skip and log a row that
  doesn't decode instead of failing the person's whole feed.
- Texts are checked with `crates/shown_text`: items are named by target, never
  copied into words.
