# models_forms

## What it is

Part of Macro Forms. The wire vocabulary: ids, layout, answers, submission
outcomes, and summaries. A form is a view of one database table — answers
reuse `models_databases` cells, gate rules reuse its filters, unchanged.

## Start here

- `src/form.rs`: `Form`, `CreateForm`, `UpdateForm`, `Audience`, `FormStatus`.
- `src/layout.rs`: `FormLayout`/`FormSection` — how a table's columns map to
  form questions, including booking sections (`BookingTarget`).
- `src/response.rs`: `FormResponse`, `Answer`, tallying (`FormTally`,
  `QuestionTally`) and `SubmissionOutcome`.
- `src/detail.rs`: the expanded detail shape (`FormDetail`,
  `FormQuestionDetail`) used by the builder UI.
- `src/collaboration.rs`: `FormCollaboration`, `FormPublicationProblem`.

## Scope

- Owns: form ids, layout, response/tally, and error types.
- Not here: database ops/cells/filters (reused as-is) → `models_databases`;
  form service logic and storage → `forms`.

## Boundaries

- Depends on: `macro_uuid`, `models_databases` (feature `schema` forwards to
  `models_databases/schema`).
- Used by: `forms`.

## Recipes

- Add a question/layout kind: `src/layout.rs` → `src/detail.rs` →
  `src/response.rs` (answer/tally shape) → `forms` service.

## Checks

- `cargo test -p models_forms` (`SQLX_OFFLINE` unset).

## Related

- Skill: `database-core`
