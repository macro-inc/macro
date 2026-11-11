# Bulk table facts

`group-b.table-facts` accepts `{keys: u32[]}` through the existing read-only
application query. Both WASM kind 9 and native FFI forward the same JSON DTO.
The envelope generation must match the current model before payload decoding;
unknown fields/types and any missing, detached or non-table target reject the
whole request. Empty keys return an empty result. Request order is preserved.
No model publication revision is required; selection-only changes do not retire
an otherwise live table key.

The reply is `{generation, tables}`. Each table contains:

- `key: {index, generation}`, `rowCount`, `columnCount`.
- `rows`: actual tree order, with `key`, nullable stored `height`, and ordered
  `cellKeys`. Missing row heights have already become None in the model.
- `slots`: the exact `compute_table_map` row arrays, including ragged lengths,
  repeated spanning-cell keys and null holes. `columnCount` is the core map's
  first-row width, not the maximum row length.
- `cells`: unique cells in tree order, with `key`, `row`, `column`, `rowSpan`,
  `colSpan`, unmasked `headerState`, nullable stored `width`, `backgroundColor`
  and `verticalAlign`. Every origin/span/header comes from the core table map;
  the query does not implement placement. A cell absent from that map rejects
  rather than inventing a layout.
- `colWidths`: `{kind:"missing"}`, `{kind:"null"}`, or
  `{kind:"value",value:[number|null]}`. Empty arrays and null slots remain
  distinct from missing/null properties.
- `frozenRowCount`, `frozenColumnCount`, `rowStriping`.

Stored numbers use the existing JsNumber/exportJSON semantics, including its
nonfinite-to-null behavior; these are presentation observations, not an archival
raw-number representation. No dimensions are measured or defaulted here.
No content/state snapshots, editor handles, host callbacks or caches are retained.

The existing `group-b.table-resize` query remains the sole resize capture policy
for actual DOM measurements, zoom, base sizes and revert values. Generic facts
are not a resize baseline, current write authorization or an observation token.
Every later action still requires the real attached/type/generation checks and
normal session admission. This producer alone does not install a web menu,
Android grid, scrolling, selection UI or connected-device acceptance.
