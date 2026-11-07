//! workspace-hack maintenance through the hakari library — the same engine
//! the `cargo hakari` CLI wraps, minus the CLI (and its version skew).

use anyhow::{Context, Result, anyhow};
use guppy::PackageId;
use guppy::graph::PackageGraph;
use hakari::HakariBuilder;
use hakari::summaries::{DEFAULT_CONFIG_PATH, HakariConfig};
use hakari::verify::VerifyErrors;
use serde::Deserialize;
use std::collections::{BTreeSet, HashSet};

/// Xtask-only extension to `.config/hakari.toml`: the hakari engine only
/// accepts exact member names in `workspace-members`, so path globs live in
/// an `[xtask]` table it ignores and are expanded here.
#[derive(Debug, Default, Deserialize)]
struct XtaskConfig {
    #[serde(default)]
    xtask: XtaskSection,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "kebab-case")]
struct XtaskSection {
    /// Workspace-relative member-path globs, a literal prefix ending in a
    /// single `*` (e.g. `crates/client/*`). Every matched member becomes a
    /// traversal exclude: not unified into workspace-hack and never given
    /// the workspace-hack dependency by manage-deps.
    #[serde(default)]
    traversal_exclude_globs: Vec<String>,
}

/// Expands the path globs against workspace member paths. A glob matching
/// nothing is an error — it is either a typo or a stale entry.
fn glob_excludes<'g>(graph: &'g PackageGraph, globs: &[String]) -> Result<Vec<&'g PackageId>> {
    let mut ids = Vec::new();
    for glob in globs {
        let prefix = glob.strip_suffix('*').ok_or_else(|| {
            anyhow!("[xtask] traversal-exclude-globs entry `{glob}` must end with `*`")
        })?;
        let matched: Vec<_> = graph
            .workspace()
            .iter_by_path()
            .filter(|(path, _)| path.as_str().starts_with(prefix))
            .map(|(_, package)| package.id())
            .collect();
        if matched.is_empty() {
            return Err(anyhow!(
                "[xtask] traversal-exclude-globs entry `{glob}` matched no workspace members"
            ));
        }
        ids.extend(matched);
    }
    Ok(ids)
}

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
    let xtask_config: XtaskConfig = toml::from_str(&contents)
        .map_err(|e| anyhow!("parsing [xtask] section of {config_path}: {e}"))?;
    let extra_excludes = glob_excludes(graph, &xtask_config.xtask.traversal_exclude_globs)?;
    let make_builder = || -> Result<HakariBuilder<'_>> {
        let mut builder = config
            .builder
            .to_hakari_builder(graph)
            .map_err(|e| anyhow!("resolving {config_path}: {e}"))?;
        builder
            .add_traversal_excludes(extra_excludes.iter().copied())
            .map_err(|e| anyhow!("applying [xtask] traversal-exclude-globs: {e}"))?;
        Ok(builder)
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
    let builder = make_builder()?;
    let final_excludes: HashSet<&PackageId> = builder.final_excludes().collect();
    check_final_excludes_inherited(graph, &final_excludes)?;
    if let Err(errs) = builder.verify() {
        let failures = unification_failures(&errs, &final_excludes);
        if !failures.is_empty() {
            return Err(anyhow!(
                "workspace-hack does not fully unify features for {}:\n{}",
                failures.join(", "),
                errs.display()
            ));
        }
    }

    Ok(changed)
}

/// The dependencies hakari's verify reports that real builds compile in more
/// than one feature set. Two kinds of report are skipped:
///
/// - Feature sets no workspace package builds, which hakari's post-compute
///   fixups add once some crates are final-excluded.
/// - The final-excluded crates themselves: their features are unified by
///   their root `[workspace.dependencies]` entry instead
///   ([`check_final_excludes_inherited`]), and dev-only features such as
///   `rig-core/test-utils` are meant to stay out of normal builds.
fn unification_failures(
    errs: &VerifyErrors<'_>,
    final_excludes: &HashSet<&PackageId>,
) -> Vec<String> {
    let mut failures = BTreeSet::new();
    for ((_, package_id), value) in &errs.hakari.computed_map {
        if final_excludes.contains(package_id) {
            continue;
        }
        for (_, inner_map) in value.inner_maps() {
            let built = inner_map
                .values()
                .filter(|inner| !inner.workspace_packages.is_empty())
                .count();
            if built > 1 {
                failures.insert(package_id.repr().to_owned());
            }
        }
    }
    failures.into_iter().collect()
}

/// Members that depend on a final-excluded crate must take it from the root
/// `[workspace.dependencies]` entry, whose features are the union every user
/// gets. Otherwise two services could build it differently and miss the
/// union-built dependency caches.
fn check_final_excludes_inherited(
    graph: &PackageGraph,
    final_excludes: &HashSet<&PackageId>,
) -> Result<()> {
    let names: BTreeSet<&str> = final_excludes
        .iter()
        .map(|id| graph.metadata(id).map(|package| package.name()))
        .collect::<Result<_, _>>()?;
    let mut offenders = Vec::new();
    for package in graph.workspace().iter() {
        let manifest_path = package.manifest_path();
        let contents = std::fs::read_to_string(manifest_path)
            .with_context(|| format!("reading {manifest_path}"))?;
        let manifest: toml::Table =
            toml::from_str(&contents).with_context(|| format!("parsing {manifest_path}"))?;
        for name in non_inherited(&manifest, &names) {
            offenders.push(format!("{} -> {name}", package.name()));
        }
    }
    if offenders.is_empty() {
        return Ok(());
    }
    Err(anyhow!(
        "final-excluded crates must be declared with `{{ workspace = true }}` so every user gets the root entry's features:\n  - {}",
        offenders.join("\n  - ")
    ))
}

/// The crates in `names` that a manifest depends on without
/// `workspace = true`, in any dependency table, renamed or not.
fn non_inherited<'m>(manifest: &'m toml::Table, names: &BTreeSet<&str>) -> Vec<&'m str> {
    dependency_entries(manifest)
        .into_iter()
        .filter_map(|(key, value)| {
            let name = value
                .get("package")
                .and_then(toml::Value::as_str)
                .unwrap_or(key);
            let inherited = value.get("workspace").and_then(toml::Value::as_bool) == Some(true);
            (names.contains(name) && !inherited).then_some(name)
        })
        .collect()
}

/// Every `(key, value)` in a manifest's dependency tables, including
/// `[target.'cfg(..)'.*]` ones.
fn dependency_entries(manifest: &toml::Table) -> Vec<(&str, &toml::Value)> {
    const TABLES: [&str; 3] = ["dependencies", "dev-dependencies", "build-dependencies"];
    let mut tables: Vec<&toml::Table> = TABLES
        .iter()
        .filter_map(|table| manifest.get(*table).and_then(toml::Value::as_table))
        .collect();
    if let Some(targets) = manifest.get("target").and_then(toml::Value::as_table) {
        for target in targets.values().filter_map(toml::Value::as_table) {
            tables.extend(
                TABLES
                    .iter()
                    .filter_map(|table| target.get(*table).and_then(toml::Value::as_table)),
            );
        }
    }
    tables
        .into_iter()
        .flat_map(|table| table.iter().map(|(key, value)| (key.as_str(), value)))
        .collect()
}

#[cfg(test)]
mod test;
