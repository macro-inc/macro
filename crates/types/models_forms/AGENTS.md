# models_forms

## What it is

Part of Macro Forms. The wire vocabulary: ids, layout, answers, submission
outcomes, and summaries. A form is a view of one database table — answers
reuse `databases_types` cells, gate rules reuse its filters, unchanged.

## Start here

- `src/form.rs`: `Form`, `CreateForm`, `UpdateForm`, `Audience`, `FormStatus`.
- `src/branding.rs`: `FormBranding` (logo, cover image, `AccentColor`), one
  struct so it can be gated as a unit.
- `src/layout.rs`: `FormLayout`/`FormSection` — how a table's columns map to
  form questions, including booking sections (`BookingTarget`).
- `src/response.rs`: `FormResponse`, `Answer`, tallying (`FormTally`,
  `QuestionTally`) and `SubmissionOutcome`.
- `src/detail.rs`: the expanded detail shape (`FormDetail`,
  `FormQuestionDetail`) used by the builder UI.
- `src/collaboration.rs`: `FormCollaboration`, `FormPublicationProblem`.

## Scope

- Owns: form ids, layout, response/tally, and error types.
- Not here: database ops/cells/filters (reused as-is) → `databases_types`;
  form service logic and storage → `forms`.

## Boundaries

- Depends on: `macro_uuid`, `databases_types` (feature `schema` forwards to
  `databases_types/schema`).
- Used by: `forms`.

## Recipes

- Add a question/layout kind: `src/layout.rs` → `src/detail.rs` →
  `src/response.rs` (answer/tally shape) → `forms` service.

## Checks

- `cargo test -p models_forms` (`SQLX_OFFLINE` unset).

## Related

- Skill: `database-core`
