# dynamic_ui

## What it is

The view an agent shows a person (`execution.views.present` in agent
sessions, `DisplayResults` in chat), as the web's dynamic-UI renderer draws
it. `View` and `Widget` are the source of truth: decoding into them is the
only validation, the model's JSON Schema comes from them through schemars,
and the web's TypeScript through specta.

## Start here

- `src/view.rs`: `View`, `Widget` and their parts. A variant's doc comment is
  the model's guidance for it; it reaches ExecuteCode's description and the
  `DisplayResults` tool schema.
- `src/query.rs`: the list widget's filter, the web's Next Soup `Query`.
- `src/decode.rs`: `decode_view` and `deserialize_view`. A field the types do
  not name is ignored.
- `src/pane.rs`: panes, the widgets a saved view (a `dashboards` dashboard)
  addresses by their optional `id`: `View::replace_pane` and
  `View::duplicate_pane_id`.

## Boundaries

- Depends on: `serde`, `serde_path_to_error`, `schemars`, `specta`, `nutype`.
- Used by: `agent_code_mode` (`execution.views.present`, ExecuteCode's
  description), `ai_tools` (`DisplayResults`), `agent_fold` (view tool
  details and activity cards, built for wasm too), `dashboards` (saved
  views).

## Recipes

- Add a widget: add a `Widget` variant with its doc comment and an `id`
  field like its siblings, give it arms in `src/pane.rs` (its children, if it
  nests widgets), run
  `just gen-dynamic-ui-types` in `apps/web`, and add its arm to `Render` in
  `apps/web/src/features/dynamic-ui/render.tsx`; the exhaustive `match` fails
  to compile until you do.
- Bound a value (a count, a range, a non-empty string): make it a `nutype`
  newtype so an out-of-range value fails to decode, and give the field a
  schemars attribute (`range`, `length`) so the model's schema shows the
  bound. nutype supports only schemars 0.8.

## Checks

- `cargo test -p dynamic_ui`; `the_present_view_schema_is_pinned` snapshots
  the model-facing schema with insta.
- `just gen-dynamic-ui-types` in `apps/web`, then commit
  `src/features/dynamic-ui/generated` and `packages/lexical-core/generated`;
  CI's Check Specta Types step fails when they are stale.

## Gotchas

- Problems name a place and what belongs there, never what the view holds:
  they reach logs and the model with the failed call. `decode.rs` drops the
  value serde quotes.
- `view.rs` and `query.rs` are exempt from `missing_docs`: every doc comment
  there becomes a description in the schema ExecuteCode carries on every
  turn, so document only what guides the model.
- The model's schema is a subset of what decodes: `not` negates a single
  clause there, while decoding takes any expression. A recursive field must
  stay optional or behind a list in the schema, or Gemini rejects every
  request carrying `DisplayResults`; `ai_tools` tests fail when one does not.
  The inlined view schema also sits at Gemini's nesting limit of 30 levels, so a
  type nested one level deeper fails the same tests.
- Paths stop at an internally tagged widget: serde buffers a tagged variant's
  fields, so a problem inside one names the widget, not the field.
- The browser never validates a view: every path decodes it on the server
  first. Render views only from decoded data (a `DisplayResults` result, a
  presented view's result, a stored activity card), never from the model's
  arguments.
