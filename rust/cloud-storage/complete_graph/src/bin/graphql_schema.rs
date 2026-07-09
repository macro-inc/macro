use std::{fs, path::PathBuf};

use anyhow::{Context, Result};

fn main() -> Result<()> {
    let output_path = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .context("usage: graphql_schema <output-path>")?;

    let schema = complete_graph::build_schema().sdl();

    if let Some(parent) = output_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)
            .with_context(|| format!("creating parent directory {}", parent.display()))?;
    }

    fs::write(&output_path, format!("{schema}\n"))
        .with_context(|| format!("writing GraphQL Soup schema to {}", output_path.display()))?;

    println!("wrote GraphQL Soup schema to {}", output_path.display());
    Ok(())
}
