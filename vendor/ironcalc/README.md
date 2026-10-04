# IronCalc (vendored)

Macro calculates spreadsheets with [IronCalc](https://github.com/ironcalc/IronCalc),
an MIT/Apache-2.0 spreadsheet engine in Rust. This directory holds a fork of its
engine (`base/`) and WebAssembly bindings (`bindings/wasm/`), taken from upstream
`main` at the commit in `upstream.json`, plus the patches listed below.

`pkg/` is the built `@ironcalc/wasm` package. It is committed and registered as
a Bun workspace, so the web app, `packages/spreadsheet` and the AI editing worker
resolve `@ironcalc/wasm` to it without a Rust toolchain. Rebuild it after any
change here:

```sh
cd vendor/ironcalc
./build.sh          # rebuild pkg/
./build.sh --check  # verify pkg/ matches the sources
```

`build.sh` needs the repository's Rust toolchain (`rust-toolchain.toml` already
includes `wasm32-unknown-unknown`), `wasm-bindgen-cli` at the `wasm-bindgen`
version in `Cargo.lock` (`cargo install wasm-bindgen-cli --version <version>
--locked`), `wasm-opt` from [binaryen](https://github.com/WebAssembly/binaryen)
and Bun. The crates form their own Cargo workspace, outside the repository's
root workspace and its lint settings. Run the engine's own tests with
`cargo test -p ironcalc_base`.

## Why a fork

The last npm release (0.8.4) predates upstream's new evaluation algorithm,
corrected implicit intersection and array support in many functions. With
them, a project-finance model that took over eight minutes calculates in under
two seconds, and the real-world corpus (`apps/web/.../xlsx-fixtures/real-world`)
matches Excel on several hundred more formulas. The patches below fix gaps the
corpus found.

## Patches

Changes to upstream files are marked with `MACRO:` comments; new files say so at
the top. `base/src/test/test_macro_patches.rs` tests them.

Build and packaging:

- `base/build.rs`: report the vendored commit from `INFO("release")` instead of
  running `git describe` inside this repository.
- `bindings/wasm/Cargo.toml`: the `xlsx` feature is a no-op; upstream's `xlsx`
  crate is not vendored.

Calculation, to match Excel:

- Single-value parameters receiving a range or an array are evaluated once per
  element (`functions/lift.rs`, `lifted_parameters` in
  `expressions/parser/static_analysis.rs`, the `evaluate_function` wrapper in
  `functions/mod.rs`): `SUMPRODUCT(--ISNUMBER(SEARCH("x", A1:A9)))`,
  `SUM(ROUND(A1:A9, 0))`, `SUMPRODUCT(1/COUNTIF(A1:A9, A1:A9))`. Lookup values
  and `*IFS` criteria are lifted too. `test/test_fn_concatenate.rs` now expects
  `CONCATENATE(A1:A3, "!")` to spill, as in Excel.
- COUNT, PRODUCT, CONCAT and TEXTJOIN read computed arrays; TEXTJOIN with
  `ignore_empty` also skips empty text.
- XLOOKUP searches computed arrays, such as `(A1:A9="x")*(B1:B9="y")`, and
  returns a whole row or column of a two-dimensional return array
  (`functions/xlookup.rs`, `static_analysis_xlookup`).
- INDEX gives a reference in reference contexts, and the range operator spans
  any two references on a sheet: `SUM(A1:INDEX(A:A, n))`, `ROWS(A1:INDEX(...))`
  (`index_reference`, `get_range` in `model.rs`).
- AGGREGATE (`functions/aggregate.rs`), which upstream does not have. Its name
  is matched outside the language data, which does not list it yet.
- `"<>text"` criteria match numbers and blanks (`functions/util.rs`).
- Approximate lookups (LOOKUP, VLOOKUP, HLOOKUP, MATCH) compare the lookup value
  only with values of its own type (`functions/binary_search.rs`):
  `LOOKUP("", numbers)` is #N/A and `LOOKUP(9.99E+307, A:A)` finds the last
  number.
- SHEET of a reference gives the reference's sheet.
- LEFT, RIGHT, MID and the other text functions count with booleans and text
  that reads as a number: `LEFT("abc", "2")`.

Host hooks in the WebAssembly package:

- `setFixedTime(ms)` fixes the time NOW and TODAY read, and
  `setRandomSeed(seed)` makes RAND, RANDBETWEEN and RANDARRAY repeatable, for
  tests and reproducible imports (`model.rs`, `math_and_trigonometry/random.rs`).

Known gaps: dates before 1 March 1900 are a day off (Excel's fictional 29
February 1900), direct text and boolean arguments of STDEV, VAR and SUMSQ are
not counted, and LINEST, LOGEST and TREND fail on single-row inputs.

## Updating

Copy `base/` and `bindings/wasm/{src,Cargo.toml,types.ts,README.pkg.md}` from a
newer upstream checkout, reapply the patches (search for `MACRO:`), update
`upstream.json`, run `./build.sh`, then run the spreadsheet corpus test and
review its snapshot changes.
