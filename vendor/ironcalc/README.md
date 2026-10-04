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

Changes to upstream files are marked with `MACRO:` comments.

- `base/build.rs`: report the vendored commit from `INFO("release")` instead of
  running `git describe` inside this repository.
- `bindings/wasm/Cargo.toml`: the `xlsx` feature is a no-op; upstream's `xlsx`
  crate is not vendored.

## Updating

Copy `base/` and `bindings/wasm/{src,Cargo.toml,types.ts,README.pkg.md}` from a
newer upstream checkout, reapply the patches (search for `MACRO:`), update
`upstream.json`, run `./build.sh`, then run the spreadsheet corpus test and
review its snapshot changes.
