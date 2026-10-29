# routine_suggestions

## What it is

Part of Routines: the AI-picked routines offered in each view sidebar, below
the user's routines on the Routines page, and in onboarding's last step. One
row per user in `routine_suggestion_set` holds the latest generated set.

## How it works

`GET /routine-suggestions` returns the stored set and starts a background
generation when there is none, it is older than three days, or the last one
failed a while ago. A generation claims the row, reads the newest inbox
messages straight from Gmail and Outlook through the email service (so it
works before the mailbox has synchronized), asks the free-tier model for a
lenient JSON answer, validates each suggestion, and stores the result if it
still owns the row. Clients poll while `status` is `generating`.

## Start here

- `src/domain/service.rs`: when to generate, the claim, the background run.
- `src/domain/decode.rs`: the model's answer schema and per-item validation.
- `src/domain/prompt.md`: the system prompt, including the keep-probability
  calibration onboarding uses to turn suggestions on by default.

## Scope

- Owns: generating, validating, and storing suggestions.
- Not here: creating the routine a user enables → `crates/scheduled_action`;
  choosing which suggestions start switched on → the web app's
  `features/routine-suggestions`.

## Boundaries

- Depends on: `email_service_client` (`/internal/recent_messages`), `agent`
  (structured completion), `ai_usage` (metered as the non-billable
  `RoutineSuggestions` feature).
- Used by: `services/agent_harness_service` (cognition routes).

## Recipes

- Add a field the model fills: `RawSuggestion` in `src/domain/decode.rs` →
  `RoutineSuggestion` in `src/domain/model.rs` → regenerate the web client.
- Add a surface, icon, or event: its enum in `src/domain/model.rs` and the
  matching `RawSuggestion` doc comment (the schema test checks they agree).

## Checks

- `cargo test -p routine_suggestions` (`SQLX_OFFLINE` unset).

## Gotchas

- `RawSuggestion` doc comments are the model-facing field descriptions.
- Stored suggestions that no longer decode are skipped on read, not an error:
  rows are rewritten every few days.
- Inbox content is untrusted third-party text; it goes in the user message as
  JSON data, and the web app never turns on an `affectsOthers` suggestion by
  default.

## Related

- Rules: `.agents/rules/rust/architecture.md` · Docs: `docs/agent-guide/setup-cards.md`
