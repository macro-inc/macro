//! Checks the Cargo dependency boundary around Macro Connect.

use std::path::Path;

use anyhow::{Context, Result, bail};
use guppy::graph::PackageGraph;

fn under_connect(path: &Path) -> bool {
    path.starts_with("connect")
}

/// Returns every boundary violation for a workspace package and its direct
/// workspace dependencies. Manifest paths are relative to the workspace root.
fn violations<'a>(
    name: &str,
    manifest_path: &Path,
    dependencies: impl IntoIterator<Item = (&'a str, &'a Path)>,
) -> Vec<String> {
    let in_connect = under_connect(manifest_path);
    let mut violations = Vec::new();

    if in_connect && !name.starts_with("connect_") {
        violations.push(format!(
            "{name} -> {name}: package under connect/ must be named connect_*"
        ));
    }

    for (dependency, dependency_path) in dependencies {
        if in_connect && !under_connect(dependency_path) && dependency != "workspace-hack" {
            violations.push(format!(
                "{name} -> {dependency}: connect/ package depends on a Macro workspace package"
            ));
        } else if !in_connect && under_connect(dependency_path) && dependency != "connect_client" {
            violations.push(format!(
                "{name} -> {dependency}: Macro package depends on a non-client connect/ package"
            ));
        }
    }

    violations
}

pub fn check(graph: &PackageGraph) -> Result<()> {
    let root = graph.workspace().root();
    let mut all_violations = Vec::new();

    for package in graph.workspace().iter() {
        let manifest_path = package
            .manifest_path()
            .strip_prefix(root)
            .with_context(|| {
                format!("{} is outside the workspace root", package.manifest_path())
            })?;
        let dependencies = package
            .direct_links()
            .filter(|link| link.to().in_workspace())
            .map(|link| {
                let dependency = link.to();
                let path = dependency
                    .manifest_path()
                    .strip_prefix(root)
                    .with_context(|| {
                        format!(
                            "{} is outside the workspace root",
                            dependency.manifest_path()
                        )
                    })?;
                Ok((dependency.name(), path.as_std_path()))
            })
            .collect::<Result<Vec<_>>>()?;

        all_violations.extend(violations(
            package.name(),
            manifest_path.as_std_path(),
            dependencies,
        ));
    }

    if !all_violations.is_empty() {
        bail!(
            "Macro Connect Cargo boundary violations:\n{}",
            all_violations.join("\n")
        );
    }
    Ok(())
}

#[cfg(test)]
mod test;
