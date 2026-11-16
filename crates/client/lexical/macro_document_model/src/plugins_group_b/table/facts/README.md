# Bulk table facts

`group-b.table-facts` accepts `{keys: u32[]}` through the read-only application
query (WASM kind 9 and FFI share the JSON DTO). Generation is checked before
decoding; unknown fields and any missing, detached or non-table key reject the
whole request. Empty keys return an empty result; request order is preserved.

The reply is `{generation, tables}`. Each table has:

- `key: {index, generation}`, `rowCount`, `columnCount` (the core map's
  first-row width, not the longest row).
- `rows`: tree order, with `key`, nullable `height` and ordered `cellKeys`.
- `slots`: the exact `compute_table_map` rows, including ragged lengths, repeated
  spanning-cell keys and null holes.
- `cells`: unique cells in tree order with map origin, spans, unmasked
  `headerState`, and nullable `width`, `backgroundColor`, `verticalAlign`. A cell
  absent from the map rejects rather than inventing a layout.
- `colWidths`: `{kind:"missing"}`, `{kind:"null"}` or `{kind:"value",value:[number|null]}`.
- `frozenRowCount`, `frozenColumnCount`, `rowStriping`.
- `selection`: null without a TableSelection on this table, otherwise
  `{deleteExtent, selectedCellKeys}`. Selected keys come from TableSelection
  traversal (preserving merged-cell closure), not from the delete rectangle.
- Each cell's `selectionDelete`: whether its origin lies inside the delete
  bounds per axis. Hosts must not derive selected cells from these flags.

Numbers use `exportJSON` semantics (nonfinite becomes null). Nothing is measured
or defaulted and nothing is cached. `group-b.table-resize` stays the only resize
measurement and revert policy; these facts grant no write authority.
