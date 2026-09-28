//! `cargo x doppler-bins <changed-files-path>`
//!
//! Computes which "doppler config" validation binaries are affected by a set of
//! changed files, for Rust service CI.
//!
//! A handful of services ship a `doppler_config` binary — a `[[bin]]` whose
//! source is `src/doppler_config.rs` — that loads the service's `Config` from
//! Doppler for both the dev and prod environments. It is a config-contract
//! check: if the code expects a field Doppler doesn't have, the binary fails.
//! CI only needs to run it for a service when that service's config could have
//! changed, i.e. when its `src/config.rs`, `src/doppler_config.rs`, or
//! `Cargo.toml` changed.
//! Services explicitly awaiting bootstrap in `.github/services-config.json`
//! defer this live check. Changing the inventory revalidates every ready service,
//! so removing that marker cannot bypass its first config validation.
//!
//! Input is a newline-delimited file of paths relative to the repository root
//! (typically `git diff --name-only ...`). Output is the affected bin names, one
//! per line, sorted and deduplicated.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use guppy::graph::{BuildTargetId, PackageGraph};
use xtask_graph::build_graph;

#[cfg(test)]
mod test;

/// Source path (relative to a crate root) of a service's doppler-config binary.
const DOPPLER_CONFIG_SRC: &str = "src/doppler_config.rs";
const SERVICES_CONFIG: &str = ".github/services-config.json";

#[derive(serde::Deserialize)]
struct ServicesConfig {
    services: BTreeMap<String, ServiceConfig>,
}

#[derive(serde::Deserialize)]
struct ServiceConfig {
    bootstrap_pending: Option<String>,
    #[serde(default)]
    deploy_binaries: Vec<String>,
    #[serde(default)]
    deploy_lambdas: Vec<String>,
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.iter().map(String::as_str).collect::<Vec<_>>()[..] {
        [changed_files_path] => {
            // Read-only: `--locked` so computing the filter never rewrites Cargo.lock.
            let graph = build_graph(true)?;
            run(&graph, Path::new(changed_files_path))
        }
        _ => bail!("usage: cargo x doppler-bins <changed-files-path>"),
    }
}

fn run(graph: &PackageGraph, changed_files_path: &Path) -> Result<()> {
    let repo_root = graph.workspace().root();
    let services: ServicesConfig = serde_json::from_slice(
        &std::fs::read(repo_root.join(SERVICES_CONFIG)).context("reading service inventory")?,
    )
    .context("parsing service inventory")?;

    let changed_files = std::fs::read_to_string(changed_files_path).with_context(|| {
        format!(
            "reading changed files from {}",
            changed_files_path.display()
        )
    })?;
    let changed: BTreeSet<PathBuf> = changed_files
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| repo_root.join(line).into_std_path_buf())
        .collect();

    for bin in config_bins(graph, &changed, &services)? {
        println!("{bin}");
    }
    Ok(())
}

fn config_bins(
    graph: &PackageGraph,
    changed: &BTreeSet<PathBuf>,
    services: &ServicesConfig,
) -> Result<BTreeSet<String>> {
    let workspace = graph.workspace();
    let inventory_changed =
        changed.contains(&workspace.root().join(SERVICES_CONFIG).into_std_path_buf());
    let mut bins = BTreeSet::new();
    for package in workspace.iter() {
        // Only services that actually ship a `src/doppler_config.rs` binary.
        let Some(bin_name) = package
            .build_targets()
            .find_map(|target| match target.id() {
                BuildTargetId::Binary(name) if target.path().ends_with(DOPPLER_CONFIG_SRC) => {
                    Some(name)
                }
                _ => None,
            })
        else {
            continue;
        };

        if let Some((service, reason)) = services.services.iter().find_map(|(name, service)| {
            let reason = service.bootstrap_pending.as_ref()?;
            package
                .build_targets()
                .any(|target| match target.id() {
                    BuildTargetId::Binary(name) => service
                        .deploy_binaries
                        .iter()
                        .chain(&service.deploy_lambdas)
                        .any(|binary| binary == name),
                    _ => false,
                })
                .then_some((name, reason))
        }) {
            eprintln!("Deferring {service} live Doppler validation: {reason}");
            continue;
        }

        let dir = package
            .manifest_path()
            .parent()
            .with_context(|| format!("manifest {} has no parent", package.manifest_path()))?;

        // Re-validate when the config schema, the validator, or the manifest changes.
        let triggers = [
            dir.join("src/config.rs").into_std_path_buf(),
            dir.join(DOPPLER_CONFIG_SRC).into_std_path_buf(),
            dir.join("Cargo.toml").into_std_path_buf(),
        ];
        if inventory_changed || triggers.iter().any(|trigger| changed.contains(trigger)) {
            bins.insert(bin_name.to_owned());
        }
    }

    Ok(bins)
}
