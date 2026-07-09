//! `cargo x workflows [--check]`
//!
//! Generates the repo's GitHub Actions workflows from Rust (see the
//! [`workflows`] module). The `--check` variant regenerates them in memory and
//! fails if the committed YAML has drifted, so CI can guarantee the checked-in
//! YAML always matches this source.

mod workflows;

use anyhow::{Result, bail};

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.iter().map(String::as_str).collect::<Vec<_>>()[..] {
        [] => workflows::generate(),
        ["--check"] => workflows::check(),
        _ => bail!("usage: cargo x workflows [--check]"),
    }
}
