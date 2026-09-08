# The SQL editor (CodeMirror)

One reusable editor component used by query chips, views, charts, and (later) a
full-screen query console. We already ship CodeMirror in
`apps/web/src/features/block-code/component/CodeMirror.tsx` with several
`@codemirror/lang-*` packages — add `@codemirror/lang-sql` and build the databases editor
as an extension suite on top, themed with the existing block-code CM theme so it inherits
Macro Dark/Light tokens.

## Extension inventory

- **Schema-aware autocomplete.** `lang-sql` accepts a schema object — feed it the same
  catalog the executor prepares against (user tables, junction views, magic tables, all
  with columns), kept fresh via the table version counters. Table names after
  `FROM`/`JOIN`, columns scoped by alias, `HAS` offered after multi/entity columns.
- **Chips inside SQL.** `@` opens the mentions typeahead; picked entities render as CM
  widget decorations — real chips (`Decoration.replace` + atomic ranges) that compile to
  typed id literals. Same mechanism for `@table` / `@column` references. Chips survive
  copy/paste as their literal form.
- **Join-path suggestions.** After `JOIN`, offer link columns as pre-baked paths
  ("through Sessions 🔗" inserts the junction join pair). Hand-written SQL reuses the
  relationships the GUI declared.
- **Inline diagnostics.** Debounced prepare against the schema-only catalog (no data);
  SQLite's errors surface as CM lint diagnostics ("no such column: guets.status") with
  fix-its for near-miss identifiers.
- **Live result preview.** Debounced execute-on-idle: first N rows below the editor
  (entity columns hydrated as chips), row count, and the dependency readout
  ("reads: guests, people").

## Styles of magic — DECIDED: explicit joins only

Hydration is always an explicit magic-table join. No function sugar, no path syntax:

```sql
SELECT p.email
FROM   guests g
JOIN   people p ON p.id = g.guest
WHERE  g.status = 'Going'
```

Rationale:

- One way to do it; standard SQL semantics; nothing new to teach humans or the model
  (AI emits joins with strong priors already).
- Hydration functions (`email(g.guest)`) would be easy — SQLite application-defined
  functions via `rusqlite::create_scalar_function` over the same materializer — but a
  second spelling of every hydration is complexity with no new capability. Rejected.
- Arrow deref (`g.guest->email`) is rejected outright: `->`/`->>` are SQLite's native
  JSON extraction operators (3.38+), so it either shadows real syntax or needs an
  ambiguous rewrite.

The editor makes joins cheap instead of making syntax terse: join-path completions after
`JOIN` (link columns and entity columns offer their pre-baked join pair), so the cost of
"explicit" is two keystrokes.

`HAS` (membership on multi-valued columns) is the one sugar that ships — a single-keyword
text-level rewrite, common enough to earn syntax. Revisit even that if it causes any
trouble.

## Agent authoring UX

Natural language is the primary authoring path; SQL is the inspectable artifact.

- **The prompt line** lives above the SQL, persisted with the query
  (`{prompt, sql}` both stored on the node): `✦ "everyone we still need to invite"`.
- Typing a new prompt (or editing the existing one) and hitting Enter streams a generated
  query into the editor. The model gets the schema catalog, the current query, column
  types, and sample rows.
- **Diff-accept flow**: generated SQL lands highlighted with a Keep / Undo bar — never
  silently replacing a query the user hand-edited. Regenerate (`↻`) re-runs the same
  prompt.
- Generation runs the prepare step before presenting: if the model emitted invalid SQL, it
  self-repairs against the diagnostic before the user ever sees it.
- The result preview re-runs automatically on accept, so the loop is
  prompt → SQL → rows without leaving the popover.

## Component boundaries

`features/database-sql-editor/` exporting `<SqlEditor schema={...} value onChange
onRun>`; consumers (chip popover, view/chart config, console) own persistence and layout.
No queries/mutations inside the component (house rule: composed primitives stay decoupled
from use-case context).
