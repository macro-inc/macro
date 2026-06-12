//! workspace-hack maintenance through the hakari library — the same engine
//! the `cargo hakari` CLI wraps, minus the CLI (and its version skew).

use anyhow::{anyhow, Context, Result};
use guppy::graph::PackageGraph;
use hakari::summaries::{HakariConfig, DEFAULT_CONFIG_PATH};
use hakari::HakariBuilder;

/// Regenerates (or, in check mode, diffs) the workspace-hack crate:
/// the generated section of its Cargo.toml, plus the `workspace-hack`
/// dependency line every member must carry. Also verifies the hack fully
/// unifies third-party features. Returns whether any file was modified.
pub fn run(graph: &PackageGraph, check: bool, drift: &mut Vec<String>) -> Result<bool> {
    let config_path = graph.workspace().root().join(DEFAULT_CONFIG_PATH);
    let contents =
        std::fs::read_to_string(&config_path).with_context(|| format!("reading {config_path}"))?;
    let config: HakariConfig = contents
        .parse()
        .map_err(|e| anyhow!("parsing {config_path}: {e}"))?;
    let make_builder = || -> Result<HakariBuilder<'_>> {
        config
            .builder
            .to_hakari_builder(graph)
            .map_err(|e| anyhow!("resolving {config_path}: {e}"))
    };
    let mut changed = false;

    // Generated section of workspace-hack/Cargo.toml.
    let hakari = make_builder()?.compute();
    let new_toml = hakari
        .to_toml_string(&config.output.to_options())
        .map_err(|e| anyhow!("rendering workspace-hack contents: {e}"))?;
    let existing = hakari
        .read_toml()
        .ok_or_else(|| anyhow!("hakari-package must be set in {config_path}"))?
        .context("reading workspace-hack/Cargo.toml")?;
    if existing.is_changed(&new_toml) {
        if check {
            drift.push("workspace-hack/Cargo.toml".to_owned());
        } else {
            existing
                .write_to_file(&new_toml)
                .context("writing workspace-hack/Cargo.toml")?;
            println!("updated workspace-hack/Cargo.toml");
            changed = true;
        }
    }

    // The workspace-hack dependency line in member manifests.
    let manage_builder = make_builder()?;
    let workspace_set = graph.resolve_workspace();
    let ops = manage_builder
        .manage_dep_ops(&workspace_set)
        .ok_or_else(|| anyhow!("hakari-package must be set in {config_path}"))?;
    if !ops.is_empty() {
        if check {
            drift.push("member Cargo.tomls are missing the workspace-hack dependency".to_owned());
        } else {
            ops.apply()
                .context("adding workspace-hack deps to member manifests")?;
            println!("updated member manifests with the workspace-hack dependency");
            changed = true;
        }
    }

    // Unification must be complete: every third-party crate builds in exactly
    // one feature configuration across the workspace. Graph-based, so valid
    // regardless of the file edits above.
    if let Err(errs) = make_builder()?.verify() {
        return Err(anyhow!(
            "workspace-hack does not fully unify features:\n{}",
            errs.display()
        ));
    }

    Ok(changed)
}
