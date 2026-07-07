use std::{path::Path, process::Command};

use anyhow::{Context, Result, bail};

pub(crate) fn run(output_path: &Path) -> Result<()> {
    let workspace_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .context("xtask manifest dir has no workspace root two levels up")?;

    let status = Command::new("cargo")
        .current_dir(workspace_dir)
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
