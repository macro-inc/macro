//! `cargo x graphql-soup-schema <output-path>`
//!
//! Exports the GraphQL Soup SDL to a file by running the `graphql_soup`
//! crate's schema-export bin with `SQLX_OFFLINE` so it needs no database.

use std::{path::Path, process::Command};

use anyhow::{Context, Result, bail};

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.iter().map(String::as_str).collect::<Vec<_>>()[..] {
        [output_path] => run(Path::new(output_path)),
        _ => bail!("usage: cargo x graphql-soup-schema <output-path>"),
    }
}

fn run(output_path: &Path) -> Result<()> {
    let workspace_dir = xtask_paths::workspace_root();

    let status = Command::new("cargo")
        .current_dir(&workspace_dir)
        .arg("run")
        .arg("--config")
        .arg("env.SQLX_OFFLINE=\"true\"")
        .arg("--quiet")
        .arg("-p")
        .arg("graphql_soup")
        .arg("--bin")
        .arg("graphql_soup_schema")
        .arg("--")
        .arg(output_path)
        .status()
        .with_context(|| format!("exporting GraphQL Soup schema to {}", output_path.display()))?;

    if !status.success() {
        bail!("GraphQL Soup schema export failed with status {status}");
    }

    Ok(())
}
