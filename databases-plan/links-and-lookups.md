# Links, lookups, rollups

Design stance: **the GUI never has a "join" feature.** It has link columns (write),
lookups/rollups (read), and one-hop filters (query) — each desugaring to the same junction
views the SQL surface exposes. The word JOIN appears exactly once in the product: the
"view as SQL" readout.

## Link columns (relations)

- Created from the `+` column menu: `Link to table…` → target table picker. Person and
  Company columns are secretly this same thing with a magic-table target — pin `people` /
  `companies` at the top of the picker.
- **Many-to-many** via `database_row_links` (see [storage.md](storage.md)). Cardinality
  UI ("each guest links one vendor" vs "many") is a creation-time option; storage is
  always the junction, cardinality is a constraint.
- **Two-way by default**: creating "Sessions" on Guests adds a "Guests" column to
  Sessions. The reverse column is *derived* (computed from forward links), never stored —
  so it can't drift.
- Deleting a link column orphans the reverse column gracefully (renders em-dashes),
  mirroring the broken-lookup degradation.

## Cell UX

- Linked rows render as **row chips**: target row's primary cell as the label (a person
  primary shows a person chip *through* the link), row-card hovercard showing the target's
  first ~4 fields.
- Click chip → small menu: `Open <table> ↗` / `Remove link` (+ note: removing a link never
  deletes the row on the other side).
- Click cell / ghost `+` → **row picker**: mentions-menu scoped to the target table's
  rows, searched by primary label, with `+ New row "<typed>"` that creates-and-links in
  one motion (half of linking is creating the other side on the fly).

## Lookups & rollups ("through the link")

Once a link column exists, the `+` column menu grows a contextual section:

```
Through Sessions 🔗
  room        (text)      → lookup column "⇢ Room (via Sessions)"
  starts_at   (date)
  speaker     (person)
  Σ count of sessions     → rollup column
```

- Lookup/rollup columns are **derived, query-time-only** — nothing stored, computed during
  materialization/desugar. Read-only, styled recessive (italic muted, `⇢` prefix, accent
  `via <link>` badge) so derivation reads at a glance.
- Rollups v1: count. min/max/sum by type later.
- Broken references (deleted link column or target column) degrade to a visible
  "broken lookup" cell state, never an error page.

## Lookups through entity columns

An entity column is a link to a magic table, so the same "through" section applies: a
Task column offers `status / assignee / due date` (the tasks magic table's fields = its
system/shared properties), a Company column offers its CRM fields, a Person column offers
email/org, etc.

- Read path: identical to link lookups — derived column, `⇢` + `via` badge, desugars to
  `LEFT JOIN tasks ON tasks.id = v.follow_up`.
- **Write path**: a magic-table field that is a shared/system property traces to a single
  editable base field, so the lookup cell is *editable* — changing "Status (via
  Follow-up)" writes the task's actual status through the normal task mutation path,
  visible in the Tasks module and everywhere else. This is the shared-property-binding
  rule from storage.md applied through one hop. Computed/system-owned fields
  (`created_at`, counts) stay read-only.
- The `via` badge carries the semantics: you are editing the entity itself, not a
  database-local note about it. A database-scoped "our status" column and a reflected
  "the task's status" column can coexist; the badge is the difference.

## SQL desugar

Link column + lookup =

```sql
SELECT g.*, s1.room AS "room_via_sessions"
FROM   guests g
LEFT JOIN guests__sessions j1 ON j1.row_id = g.row_id
LEFT JOIN sessions s1         ON s1.row_id = j1.linked_id
```

Shown in "view as SQL". Conversely, in the SQL editor, typing `JOIN` offers link columns
as pre-baked join paths ("through Sessions 🔗" inserts the junction pair) — hand-written
SQL reuses the relationships the GUI declared. See [sql-editor.md](sql-editor.md).

## Filtering across the link

Filter pills support exactly **one hop**: `( Sessions 🔗 → room ) is "Main Hall"`. Deeper
chains are genuinely queries; the affordance is an "edit as SQL" escape hatch, not a chain
builder. One hop covers ~95% of real use.
