//! `cargo x graphql-schema-compat [--base <rev>]`
//!
//! Compares `static_assets/schema.graphql` in the working tree against the
//! schema at the merge base with `<rev>` (default `origin/main`), the last
//! schema deployed, and fails on changes that break deployed clients.

use std::process::{Command, ExitCode};

use anyhow::{Context, Result, bail};
use xtask_graphql_schema_compat::{MIN_DEPRECATION_DAYS, incompatible_changes, parse_schema};

const SCHEMA_PATH: &str = "static_assets/schema.graphql";
const GUIDE: &str = "docs/guides/add-graphql-field.md#8-compatibility-and-rollout";

fn main() -> Result<ExitCode> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let base = match args.iter().map(String::as_str).collect::<Vec<_>>()[..] {
        [] => "origin/main",
        ["--base", base] => base,
        _ => bail!("usage: cargo x graphql-schema-compat [--base <rev>]"),
    };
    run(base)
}

fn run(base: &str) -> Result<ExitCode> {
    let root = xtask_paths::workspace_root();
    let merge_base = git(&["merge-base", base, "HEAD"])
        .with_context(|| format!("finding the merge base with {base}; fetch it first"))?;
    let merge_base = merge_base.trim();
    if git(&["ls-tree", "--name-only", merge_base, "--", SCHEMA_PATH])?
        .trim()
        .is_empty()
    {
        println!("{SCHEMA_PATH} does not exist at {merge_base}; nothing to compare");
        return Ok(ExitCode::SUCCESS);
    }
    let base_sdl = git(&["show", &format!("{merge_base}:{SCHEMA_PATH}")])?;
    let new_sdl = std::fs::read_to_string(root.join(SCHEMA_PATH))
        .with_context(|| format!("reading {SCHEMA_PATH}"))?;

    let base_schema = parse_schema(&base_sdl, &format!("{merge_base}:{SCHEMA_PATH}"))?;
    let new_schema = parse_schema(&new_sdl, SCHEMA_PATH)?;
    let problems = incompatible_changes(&base_schema, &new_schema, chrono::Utc::now().date_naive());

    if problems.is_empty() {
        println!("{SCHEMA_PATH} is compatible with {base} ({merge_base})");
        return Ok(ExitCode::SUCCESS);
    }
    eprintln!("{SCHEMA_PATH} breaks clients built against {base} ({merge_base}):");
    for problem in &problems {
        eprintln!("  - {problem}");
    }
    eprintln!(
        "\nDeployed clients keep sending old documents for weeks. Keep the element, \
         deprecate it with `Remove after YYYY-MM-DD` at least {MIN_DEPRECATION_DAYS} days out, \
         and remove it after that date. See {GUIDE}."
    );
    Ok(ExitCode::FAILURE)
}

fn git(args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .current_dir(xtask_paths::workspace_root())
        .args(args)
        .output()
        .with_context(|| format!("running git {}", args.join(" ")))?;
    if !output.status.success() {
        bail!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8(output.stdout)?)
}
