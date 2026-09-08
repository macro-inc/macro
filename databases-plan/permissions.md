# Permissions & sharing semantics

The least fun questions and the ones that most constrain everything else — decide these
early. Mechanically, permissions ride the standard rails: `EntityType::Database` +
`entity_access` (share the database; tables/rows inherit), receipts via a new axum
extractor, enforcement in the domain layer. This doc is about the *semantics*.

## Settled by the architecture

- **Query scoping is structural.** A viewer's scratch SQLite is materialized from their
  view of the world; magic tables come pre-filtered by their access. The same shared chip
  legitimately returns different results for different viewers — correct, not a bug. No
  permission checks inside SQL exist to get wrong.
- **Chips in shared docs run as the viewer**, never as the author. Persisting queries
  (never results) is what makes this workable.
- **Membership is an edge.** "Remove from table" touches the edge; the referenced entity
  and its permissions are untouched. Removing a link never deletes the row/entity on the
  other side.

## To decide: rows referencing entities the viewer can't access

A shared database of Calls where the viewer lacks access to some calls. Options per cell
and per row:

1. **Redacted chip** (visible row, "restricted" pill for the cell) — preserves table
   shape, honest about existence, mild metadata leak (the row's other, database-scoped
   cells are visible).
2. **Hidden row** — no leak, but viewers see different row counts and aggregates, and
   collaborative confusion follows ("I see 12 rows, you see 9").
3. **Redacted + request-access affordance** — the Macro-native move; the share modal flow
   already exists for docs.

Lean: **(1)/(3) for cells, never (2) for rows whose membership itself isn't secret** —
the row was put in the table on purpose; the *entity* is what's protected. But: a
database restricted to type Call where the row IS the entity makes (1) equal to leaking
that a call exists. Proposed rule: cell-level redaction for entity cells; row-level
hiding only when the row's identity column is the inaccessible entity AND the database is
type-restricted. Needs a pass with real cases before v1 ships sharing.

Whatever we choose must hold identically in: the grid, embeds, query results (the
materializer simply omits inaccessible entities from magic tables — so SQL naturally
behaves like (2) for joins; reconcile the story), and exports.

## To decide: what edit access means

- View access: read grid, run chips (as self), no mutations.
- Edit access: row/cell mutations, add columns? (column changes are schema-ish — maybe
  owner-only, like Notion's "can edit content" vs "full access").
- Owner: share, delete, restrict type, promote columns.

## To decide: bare-row hydration ownership

Hydrating a bare row mints a real entity — owned by the hydrator or the database owner?
Lean: the hydrator, consistent with "entities are people's things; databases hold edges."

## Deliberately deferred

- Per-table sharing within a database (schema supports it later).
- Public/link sharing of databases and of docs containing embeds (embed renders as viewer
  → anonymous viewers see only what anonymous access allows, likely nothing — fine).
- Cross-workspace/team scoping beyond what `entity_access` already models.
