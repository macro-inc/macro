use std::{fs, path::Path};

use anyhow::{Context, Result};

pub(crate) fn run(output_path: &Path) -> Result<()> {
    let schema = graphql_soup::build_schema().sdl();

    if let Some(parent) = output_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)
            .with_context(|| format!("creating parent directory {}", parent.display()))?;
    }

    fs::write(output_path, format!("{schema}\n"))
        .with_context(|| format!("writing GraphQL Soup schema to {}", output_path.display()))?;

    println!("wrote GraphQL Soup schema to {}", output_path.display());
    Ok(())
}
