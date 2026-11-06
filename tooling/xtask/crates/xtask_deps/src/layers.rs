//! Crate layer check: reads `.config/layers.toml` and reports workspace
//! dependency edges that cross layers in a direction the config does not
//! allow. Report-only: violations are printed and never fail the run, so the
//! baseline can be burned down before the check becomes blocking.
//!
//! A crate's layer comes from its directory (path globs), so moving a crate
//! into its group directory is what places it. Edges are matched by package
//! name in `[[allow]]`, so allow entries survive directory moves.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{Context, Result, bail};
use glob::{MatchOptions, Pattern};
use guppy::graph::PackageGraph;
use serde::Deserialize;

const CONFIG_REL: &str = ".config/layers.toml";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LayerConfig {
    /// Crate directories left out of the check entirely (workspace-hack).
    #[serde(default)]
    pub ignore: Vec<String>,
    #[serde(rename = "layer")]
    pub layers: Vec<Layer>,
    #[serde(default, rename = "allow")]
    pub allows: Vec<Allow>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Layer {
    pub name: String,
    /// Workspace-relative crate directory globs (`crates/types/**`,
    /// `crates/types/bot_id`).
    pub paths: Vec<String>,
    /// Layers whose crates this layer may depend on, its own included.
    pub may_depend_on: Vec<String>,
    /// Packages outside those layers this layer may still depend on.
    #[serde(default)]
    pub may_depend_on_packages: Vec<String>,
    /// Only dev-dependencies may point at this layer's crates.
    #[serde(default)]
    pub dev_only: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Allow {
    pub from: String,
    pub to: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Crate {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EdgeKind {
    /// A normal or build dependency (possibly also a dev-dependency).
    Normal,
    DevOnly,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Edge {
    pub from: String,
    pub to: String,
    pub kind: EdgeKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Violation {
    pub from: String,
    pub from_layer: String,
    pub to: String,
    pub to_layer: String,
    pub kind: EdgeKind,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Report {
    /// Violating edges with no `[[allow]]` entry.
    pub violations: Vec<Violation>,
    /// Violating edges covered by an `[[allow]]` entry.
    pub allowed: Vec<Violation>,
    /// `[[allow]]` entries that match no violating edge.
    pub stale_allows: Vec<Allow>,
    /// Crates no layer path matches.
    pub unassigned: Vec<String>,
    /// Layer or ignore paths without glob characters that match no crate:
    /// the crate moved or was removed.
    pub unmatched_paths: Vec<String>,
}

const MATCH_OPTIONS: MatchOptions = MatchOptions {
    case_sensitive: true,
    require_literal_separator: true,
    require_literal_leading_dot: false,
};

struct CompiledPath<'c> {
    source: &'c str,
    pattern: Pattern,
}

fn compile(paths: &[String]) -> Result<Vec<CompiledPath<'_>>> {
    paths
        .iter()
        .map(|source| {
            let pattern = Pattern::new(source)
                .map_err(|error| anyhow::anyhow!("invalid layer path glob `{source}`: {error}"))?;
            Ok(CompiledPath { source, pattern })
        })
        .collect()
}

fn matches(paths: &[CompiledPath<'_>], crate_path: &str) -> bool {
    paths
        .iter()
        .any(|path| path.pattern.matches_with(crate_path, MATCH_OPTIONS))
}

pub fn check(config: &LayerConfig, crates: &[Crate], edges: &[Edge]) -> Result<Report> {
    let mut layer_names = BTreeSet::new();
    for layer in &config.layers {
        if !layer_names.insert(layer.name.as_str()) {
            bail!("layer `{}` is defined twice", layer.name);
        }
    }
    for layer in &config.layers {
        for target in &layer.may_depend_on {
            if !layer_names.contains(target.as_str()) {
                bail!(
                    "layer `{}` may_depend_on names unknown layer `{target}`",
                    layer.name
                );
            }
        }
    }

    let ignore_paths = compile(&config.ignore)?;
    let layer_paths = config
        .layers
        .iter()
        .map(|layer| compile(&layer.paths))
        .collect::<Result<Vec<_>>>()?;

    let mut report = Report::default();
    for path in ignore_paths.iter().chain(layer_paths.iter().flatten()) {
        let literal = !path.source.contains(['*', '?', '[']);
        if literal && !crates.iter().any(|krate| krate.path == path.source) {
            report.unmatched_paths.push(path.source.to_owned());
        }
    }

    let mut ignored = BTreeSet::new();
    let mut layer_of: BTreeMap<&str, &Layer> = BTreeMap::new();
    for krate in crates {
        if matches(&ignore_paths, &krate.path) {
            ignored.insert(krate.name.as_str());
            continue;
        }
        let mut found: Option<&Layer> = None;
        for (layer, paths) in config.layers.iter().zip(&layer_paths) {
            if !matches(paths, &krate.path) {
                continue;
            }
            if let Some(first) = found {
                bail!(
                    "crate `{}` ({}) is in two layers: `{}` and `{}`",
                    krate.name,
                    krate.path,
                    first.name,
                    layer.name
                );
            }
            found = Some(layer);
        }
        match found {
            Some(layer) => {
                layer_of.insert(krate.name.as_str(), layer);
            }
            None => report.unassigned.push(krate.name.clone()),
        }
    }
    report.unassigned.sort();

    let mut allows: BTreeMap<(&str, &str), &Allow> = BTreeMap::new();
    for allow in &config.allows {
        if allows
            .insert((allow.from.as_str(), allow.to.as_str()), allow)
            .is_some()
        {
            bail!("[[allow]] {} -> {} is listed twice", allow.from, allow.to);
        }
    }
    let mut used_allows = BTreeSet::new();

    for edge in edges {
        if ignored.contains(edge.from.as_str()) || ignored.contains(edge.to.as_str()) {
            continue;
        }
        let (Some(from_layer), Some(to_layer)) = (
            layer_of.get(edge.from.as_str()),
            layer_of.get(edge.to.as_str()),
        ) else {
            continue;
        };
        let violates = match edge.kind {
            EdgeKind::DevOnly => false,
            EdgeKind::Normal if to_layer.dev_only => from_layer.name != to_layer.name,
            EdgeKind::Normal => {
                !from_layer.may_depend_on.contains(&to_layer.name)
                    && !from_layer.may_depend_on_packages.contains(&edge.to)
            }
        };
        if !violates {
            continue;
        }
        let violation = Violation {
            from: edge.from.clone(),
            from_layer: from_layer.name.clone(),
            to: edge.to.clone(),
            to_layer: to_layer.name.clone(),
            kind: edge.kind,
        };
        let key = (edge.from.as_str(), edge.to.as_str());
        if allows.contains_key(&key) {
            used_allows.insert(key);
            report.allowed.push(violation);
        } else {
            report.violations.push(violation);
        }
    }

    report.stale_allows = config
        .allows
        .iter()
        .filter(|allow| !used_allows.contains(&(allow.from.as_str(), allow.to.as_str())))
        .cloned()
        .collect();
    Ok(report)
}

/// Reads the config, checks every workspace edge and prints the report.
/// Config errors fail; violations only print.
pub fn run(graph: &PackageGraph) -> Result<()> {
    let workspace = graph.workspace();
    let root = workspace.root();
    let config_path = root.join(CONFIG_REL);
    let contents =
        std::fs::read_to_string(&config_path).with_context(|| format!("reading {config_path}"))?;
    let config: LayerConfig =
        toml::from_str(&contents).with_context(|| format!("parsing {config_path}"))?;

    let mut crates = Vec::new();
    let mut edges = Vec::new();
    for package in workspace.iter() {
        let dir = package
            .manifest_path()
            .parent()
            .with_context(|| format!("manifest {} has no parent", package.manifest_path()))?;
        crates.push(Crate {
            name: package.name().to_owned(),
            path: dir
                .strip_prefix(root)
                .with_context(|| format!("{dir} is outside the workspace root"))?
                .as_str()
                .to_owned(),
        });
        for link in package.direct_links() {
            if !link.to().in_workspace() {
                continue;
            }
            edges.push(Edge {
                from: package.name().to_owned(),
                to: link.to().name().to_owned(),
                kind: if link.dev_only() {
                    EdgeKind::DevOnly
                } else {
                    EdgeKind::Normal
                },
            });
        }
    }
    edges.sort_by(|a, b| (&a.from, &a.to).cmp(&(&b.from, &b.to)));
    edges.dedup_by(|a, b| a.from == b.from && a.to == b.to);

    let report = check(&config, &crates, &edges)?;
    println!(
        "layer check ({CONFIG_REL}, report-only): {} new violations, {} allowed, {} stale [[allow]] entries, {} unassigned crates, {} layer paths matching no crate",
        report.violations.len(),
        report.allowed.len(),
        report.stale_allows.len(),
        report.unassigned.len(),
        report.unmatched_paths.len(),
    );
    for violation in &report.violations {
        println!(
            "  violation: {} ({}) -> {} ({}): `{}` may not depend on `{}`; fix the edge, or add an [[allow]] with a reason to {CONFIG_REL}",
            violation.from,
            violation.from_layer,
            violation.to,
            violation.to_layer,
            violation.from_layer,
            violation.to_layer,
        );
    }
    for allow in &report.stale_allows {
        println!(
            "  stale allow: {} -> {} no longer violates; delete it from {CONFIG_REL}",
            allow.from, allow.to
        );
    }
    for name in &report.unassigned {
        println!("  unassigned: {name} matches no layer path; add its directory to a layer");
    }
    for path in &report.unmatched_paths {
        println!("  unmatched path: {path} matches no crate; remove or update it");
    }
    Ok(())
}

#[cfg(test)]
mod test;
