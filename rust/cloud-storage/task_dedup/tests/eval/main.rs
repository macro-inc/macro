//! Entry point for the `eval` test target. Cargo auto-discovers
//! `tests/eval/main.rs` as an integration-test target named `eval`, and
//! `automod` expands every file in `tests/eval/cases/` into a module at compile
//! time — drop a new `*.rs` file in `cases/` and it is picked up with no
//! registration in `Cargo.toml`, here, or the justfile.

mod util;

mod cases {
    automod::dir!("tests/eval/cases");
}
