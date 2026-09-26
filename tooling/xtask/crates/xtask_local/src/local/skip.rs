//! `--skip`: services left out of a local stack. A skipped Rust service is not
//! built, and no skipped service starts.

#[cfg(test)]
mod test;

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{Context, Result, bail};
use serde_yaml::Value;

use super::inventory::RUST_SERVICES;
use super::repo_root;

/// The compose profile a skipped service moves to; no command enables it.
pub const SKIPPED_PROFILE: &str = "skipped";

/// Fail unless every skipped service is one `docker/docker-compose.yml` starts
/// by default and no service that still starts depends on it.
pub fn validate(skip: &[String]) -> Result<()> {
    if skip.is_empty() {
        return Ok(());
    }
    let path = repo_root().join("docker/docker-compose.yml");
    let text =
        std::fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
    let compose: Value =
        serde_yaml::from_str(&text).with_context(|| format!("parsing {}", path.display()))?;
    check(&default_services(&compose), skip)
}

/// The cargo binaries only skipped services use.
pub fn left_out_bins(skip: &[String]) -> Vec<&'static str> {
    let kept: BTreeSet<&str> = RUST_SERVICES
        .iter()
        .filter(|svc| !is_skipped(skip, svc.compose_name))
        .map(|svc| svc.cargo_bin)
        .collect();
    let left_out: BTreeSet<&'static str> = RUST_SERVICES
        .iter()
        .filter(|svc| is_skipped(skip, svc.compose_name) && !kept.contains(svc.cargo_bin))
        .map(|svc| svc.cargo_bin)
        .collect();
    left_out.into_iter().collect()
}

/// Whether `name` is skipped.
pub fn is_skipped(skip: &[String], name: &str) -> bool {
    skip.iter().any(|skipped| skipped == name)
}

/// Services the base compose file starts without a profile, with what each
/// depends on.
fn default_services(compose: &Value) -> BTreeMap<String, Vec<String>> {
    let Some(services) = compose.get("services").and_then(Value::as_mapping) else {
        return BTreeMap::new();
    };
    services
        .iter()
        .filter_map(|(name, service)| {
            let name = name.as_str()?;
            let has_profile = service
                .get("profiles")
                .and_then(Value::as_sequence)
                .is_some_and(|profiles| !profiles.is_empty());
            if has_profile {
                return None;
            }
            let depends_on = match service.get("depends_on") {
                Some(Value::Sequence(names)) => names
                    .iter()
                    .filter_map(|dep| dep.as_str().map(str::to_owned))
                    .collect(),
                Some(Value::Mapping(deps)) => deps
                    .keys()
                    .filter_map(|dep| dep.as_str().map(str::to_owned))
                    .collect(),
                _ => Vec::new(),
            };
            Some((name.to_owned(), depends_on))
        })
        .collect()
}

fn check(services: &BTreeMap<String, Vec<String>>, skip: &[String]) -> Result<()> {
    if let Some(unknown) = skip.iter().find(|name| !services.contains_key(*name)) {
        bail!(
            "--skip {unknown}: not a service docker/docker-compose.yml starts by default; \
             choose from: {}",
            services.keys().cloned().collect::<Vec<_>>().join(", ")
        );
    }
    for (service, depends_on) in services {
        if is_skipped(skip, service) {
            continue;
        }
        if let Some(dependency) = depends_on.iter().find(|dep| is_skipped(skip, dep)) {
            bail!(
                "--skip {dependency}: {service} depends on it; skip {service} too or keep \
                 {dependency}"
            );
        }
    }
    Ok(())
}
