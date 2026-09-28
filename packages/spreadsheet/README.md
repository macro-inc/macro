# Shared spreadsheet model and AI interface

The browser editor and the deterministic spreadsheet worker use this package's
Loro model, sheet identity/reference rules, formula copying and IronCalc 0.8.4
calculation. Browser feature paths re-export the model for compatibility. WASM
loading stays at the boundary: Vite loads a URL in the browser; Cloudflare imports
a precompiled module and calls `initSync`.

`ai-types.ts` is the worker request/response contract. `ai-workbook.ts` provides:

- `readSpreadsheetForAi`: workbook inventory and sparse ranges with source,
  formula, typed value, formatted display, errors and optional styles.
- `calculateSpreadsheetForAi`: independent scratch formulas with optional
  input overrides. It never writes to Loro. IronCalc tokenization qualifies
  unqualified references to the requested source sheet, including ranges,
  absolute references, Unicode names and whole columns/rows. Each formula uses
  a separate private sheet, so scratch results cannot overwrite or accidentally
  become inputs to a source formula.
- `prepareSpreadsheetEdit`: validate and apply a bounded operation batch to a
  disposable fork, calculate the result, then return its CRDT delta. A failed
  operation discards the whole batch. The caller must commit the delta through
  the sync service's revision-checked endpoint; this function does not persist.

Read results have a shared budget of 500 populated cells and 100,000 UTF-8 bytes.
Omitted results set `truncated` and return guidance to read smaller ranges; source
strings are never silently shortened. Scratch accepts 20 formulas and up to 2,000
override cells. Edit accepts 25 operations touching up to 2,000 cells. All use the
editor's sheet, row, column, input-length, style and reference protections.

Scratch results are scalar (the top-left value of an array formula). `INDIRECT`
is rejected in scratch calculations because its runtime string reference cannot
be safely qualified to the source sheet. It remains an ordinary engine formula
when written into the workbook. Context-sensitive no-argument functions such as
`ROW()` use the private sheet's A1 position. Volatile functions follow the same
restrictions as the editor. Sheet rename/delete retain the editor's direct
reference guard; dynamic string references are not rewritten.

Tests use the real IronCalc WASM and Loro implementation. Existing frontend core
tests exercise these shared implementations through the compatibility exports.
See the worker's [local integration instructions](../../services/ai-editing-worker/src/spreadsheet/README.md).
