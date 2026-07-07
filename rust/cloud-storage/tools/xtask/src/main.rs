//! `cargo x <command>` launcher.
//!
//! Each xtask command lives in its own crate under `tools/xtask/crates/` so
//! that `cargo x <command>` compiles only that command's dependency set — e.g.
//! `cargo x cache-wasm` (needs only anyhow) does not drag in guppy/hakari,
//! aws-sdk, tokio, or bollard.
//!
//! The cargo alias (`x = "run -p xtask --"`) is static, so it always builds one
//! fixed package: this launcher. The launcher itself has no dependencies (it
//! compiles in a blink and stays warm), maps the subcommand to its command
//! crate, and re-invokes `cargo run -p xtask-<command>`. Only that crate then
//! compiles.
//!
//! The nested `cargo run` is pinned to the workspace via `--manifest-path`
//! (derived from this crate's own location at compile time) rather than by
//! changing the working directory. That makes it work no matter where the
//! launcher was invoked from — including outside the workspace, as CI does via
//! `cargo run --manifest-path .../tools/xtask/Cargo.toml -- <command>` — while
//! leaving the command's own working directory unchanged, so relative path
//! arguments still resolve against the caller's cwd.
//!
//! Repo-automation verbs each map to a dedicated crate; everything else is the
//! local/dev orchestration surface, forwarded wholesale to `xtask-local`'s clap
//! parser (which also prints the combined usage on unrecognized input).

use std::process::{Command, exit};

/// The workspace root manifest, resolved from this launcher crate's location
/// (`<workspace>/tools/xtask`) at compile time so the nested `cargo run`
/// resolves the workspace from any cwd.
const WORKSPACE_MANIFEST: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../Cargo.toml");

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();

    let package = match args.first().map(String::as_str) {
        Some("deps") => "xtask-deps",
        Some("nextest-filter") => "xtask-nextest-filter",
        Some("doppler-bins") => "xtask-doppler-bins",
        Some("graphql-soup-schema") => "xtask-graphql-soup-schema",
        Some("cache-wasm") => "xtask-cache-wasm",
        Some("kafka-topics") => "xtask-kafka-topics",
        Some("workflows") => "xtask-workflows",
        // Everything else (including no args) is the local/dev orchestration
        // surface. Forward every arg — the subcommand is its clap parser's
        // first positional.
        _ => "xtask-local",
    };

    // Known verbs forward the args after the verb; the local fallthrough keeps
    // the subcommand as its first argument.
    let forwarded: &[String] = if package == "xtask-local" {
        &args
    } else {
        &args[1..]
    };

    // Cargo sets $CARGO to its own path when it runs the alias; fall back to
    // the plain name otherwise.
    #[allow(
        clippy::disallowed_methods,
        reason = "This is not application runtime code"
    )]
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_string());
    let status = Command::new(cargo)
        .arg("run")
        .arg("--manifest-path")
        .arg(WORKSPACE_MANIFEST)
        .arg("-p")
        .arg(package)
        .arg("--")
        .args(forwarded)
        .status();

    match status {
        Ok(status) => exit(status.code().unwrap_or(1)),
        Err(e) => {
            eprintln!("xtask: failed to launch `cargo run -p {package}`: {e}");
            exit(1);
        }
    }
}
