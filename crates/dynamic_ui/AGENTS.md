# dynamic_ui

## What it is

The view an agent presents in agent sessions (`PresentView`), as the web's
dynamic-UI renderer draws it: the generated model-facing schema and
`view_problems`, which finds what the renderer would reject before a view is
presented.

## Start here

- `src/present_view.schema.generated.json`: generated; never edit by hand.
- `src/check.rs`: reads a view the way Zod does; a field the schema does not
  name is ignored, as the renderer ignores it.

## Boundaries

- Depends on: nothing but `serde_json`.
- Used by: `agent_code_mode` (the `PresentView` tool and `execution.views.present`).

## Recipes

- Change a widget: edit `apps/web/src/features/dynamic-ui/schema.ts`, then
  `bun run gen-dynamic-ui-schema` in `apps/web`.

## Checks

- `cargo test -p dynamic_ui`
- `bunx vitest run src/features/dynamic-ui/toolSchema.test.ts` in `apps/web`
  fails when the generated schema is stale.

## Gotchas

- A schema keyword the check does not read lets through views the renderer
  rejects; `the_view_check_reads_every_keyword_the_generated_schema_uses`
  fails until `CHECKED_KEYWORDS` or `IGNORED_KEYWORDS` names it.
- Problems name a place and what belongs there, never what the view holds:
  they reach logs with the failed call.
