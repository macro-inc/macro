//! `cargo x <local-orchestration-command>`
//!
//! The local/dev orchestration surface (`run-local`, `run-dev`, `zigbuild`,
//! `doctor-local`, …). It has many subcommands each with several flags, so it
//! uses a real (clap) parser rather than fixed-arity slice patterns. The
//! launcher forwards any command it does not recognize as a repo-automation
//! verb here, so unknown input surfaces both this parser's help and the
//! repo-automation verbs (via [`LAUNCHER_USAGE`]).

mod local;

use anyhow::Result;

/// The repo-automation verbs handled by the launcher. Shown alongside this
/// crate's own clap usage when an unrecognized command reaches the parser.
const LAUNCHER_USAGE: &str = indoc::indoc! {"
    repo automation (from the repository root):
      cargo x deps [--check]
      cargo x nextest-filter <changed-files-path> <base-revision>
      cargo x doppler-bins <changed-files-path>
      cargo x graphql-soup-schema <output-path>
      cargo x cache-wasm [--force]
      cargo x kafka-topics [--check]
      cargo x workflows [--check]
"};

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    local::cli::dispatch(&args, LAUNCHER_USAGE)
}
