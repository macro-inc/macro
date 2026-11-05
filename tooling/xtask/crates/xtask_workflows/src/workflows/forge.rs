//! The self-hosted forge's CI: `.gitea/workflows/`, derived from the generated
//! GitHub workflows.
//!
//! The forge reads only `.gitea/workflows/` (`WORKFLOW_DIRS` in
//! infra/platform/cluster.nix), so this allowlist is everything that can run there.
//! Deploy, release, and publish workflows are left out on purpose, as are native
//! builds that need macOS or Windows runners and checks that call GitHub's own API.

use anyhow::{Context, Result, ensure};
use serde_yaml::Value;

/// The runner label every ported job runs on (see infra/platform/cluster.nix).
pub const RUNNER_LABEL: &str = "linux-ci";
pub const DIR: &str = ".gitea/workflows";

/// A workflow the forge runs and the jobs it cannot run there.
pub struct Ported {
    pub file_name: &'static str,
    pub dropped_jobs: &'static [&'static str],
}

pub const PORTED: &[Ported] = &[
    Ported {
        file_name: "cargo_deny.yml",
        dropped_jobs: &[],
    },
    Ported {
        file_name: "cargo_workspace_dependency_check.yml",
        dropped_jobs: &[],
    },
    Ported {
        file_name: "check_generated.yml",
        dropped_jobs: &[],
    },
    Ported {
        file_name: "check_node_modules_nix.yml",
        // Needs a macOS runner.
        dropped_jobs: &["check-darwin-node-modules-nix"],
    },
    Ported {
        file_name: "check_tauri_lockfiles.yml",
        dropped_jobs: &[],
    },
    Ported {
        file_name: "code_check_cloud_storage.yml",
        // Reads production-scoped Doppler configs.
        dropped_jobs: &["doppler-config"],
    },
    Ported {
        file_name: "code_check_conventions.yml",
        dropped_jobs: &[],
    },
    Ported {
        file_name: "code_check_infra.yml",
        dropped_jobs: &[],
    },
    Ported {
        file_name: "sdk-check.yml",
        dropped_jobs: &[],
    },
    Ported {
        file_name: "web-app-check-main.yml",
        // Needs a macOS runner.
        dropped_jobs: &["ios-native-check"],
    },
];

/// Rewrite one rendered GitHub workflow for the forge: its runner label, no
/// Namespace cache volumes (the runner keeps its own), none of `dropped`, and no
/// `types` filter on pull requests. Gitea does not match `synchronize` there, so
/// a filtered workflow would never re-run on a push; the default activity types
/// are what these workflows want. Each job first puts Cargo's bin directory on
/// PATH, which hosted runners do and the job image does not.
pub fn port(yaml: &str, dropped: &[&str]) -> Result<String> {
    let mut root: Value = serde_yaml::from_str(yaml).context("parsing workflow")?;
    if let Some(pull_request) = root
        .get_mut("on")
        .and_then(|on| on.get_mut("pull_request"))
        .and_then(Value::as_mapping_mut)
    {
        pull_request.remove("types");
    }
    let jobs = root
        .get_mut("jobs")
        .and_then(Value::as_mapping_mut)
        .context("workflow has no jobs")?;
    for name in dropped {
        ensure!(jobs.remove(*name).is_some(), "no job `{name}` to drop");
    }
    for (name, job) in jobs.iter_mut() {
        let name = name.as_str().unwrap_or_default().to_owned();
        let job = job.as_mapping_mut().context("job is not a mapping")?;
        if let Some(needs) = job.get_mut("needs").and_then(Value::as_sequence_mut) {
            needs.retain(|n| !n.as_str().is_some_and(|n| dropped.contains(&n)));
        }
        if let Some(runs_on) = job.get_mut("runs-on") {
            let label = runs_on.as_str().unwrap_or_default();
            ensure!(
                label.starts_with("namespace-profile-linux") || label.starts_with("ubuntu"),
                "job `{name}` runs on `{label}`, which the forge's runners cannot serve"
            );
            *runs_on = Value::from(RUNNER_LABEL);
        }
        if let Some(steps) = job.get_mut("steps").and_then(Value::as_sequence_mut) {
            steps.insert(
                0,
                serde_yaml::from_str(
                    "{ name: Put Cargo on PATH, run: 'echo \"$HOME/.cargo/bin\" >> \"$GITHUB_PATH\"' }",
                )
                .context("parsing the PATH step")?,
            );
            steps.retain(|step| {
                !step
                    .get("uses")
                    .and_then(Value::as_str)
                    .is_some_and(|uses| uses.starts_with("namespacelabs/nscloud-cache-action"))
            });
        }
    }
    serde_yaml::to_string(&root).context("serializing ported workflow")
}

#[cfg(test)]
mod test {
    use super::*;

    const WORKFLOW: &str = r#"
on:
  pull_request:
    types: [opened, synchronize]
    branches: [main]
jobs:
  build:
    needs: [paths, ios]
    runs-on: namespace-profile-linux-small;overrides.cache-tag=web-ci
    steps:
    - uses: namespacelabs/nscloud-cache-action@abc
    - uses: actions/checkout@abc
  paths:
    runs-on: ubuntu-latest
  ios:
    runs-on: nscloud-macos-sequoia-arm64-6x14
"#;

    #[test]
    fn port_rewrites_runners_and_drops_namespace_caches_and_jobs() {
        let ported: Value = serde_yaml::from_str(&port(WORKFLOW, &["ios"]).unwrap()).unwrap();
        let build = &ported["jobs"]["build"];
        assert_eq!(build["runs-on"], RUNNER_LABEL);
        assert_eq!(build["needs"].as_sequence().unwrap().len(), 1);
        assert_eq!(build["steps"].as_sequence().unwrap().len(), 2);
        assert_eq!(build["steps"][0]["name"], "Put Cargo on PATH");
        assert!(ported["jobs"].get("ios").is_none());
        assert!(ported["on"]["pull_request"].get("types").is_none());
        assert!(ported["on"]["pull_request"].get("branches").is_some());
    }

    #[test]
    fn port_refuses_jobs_the_runners_cannot_serve() {
        assert!(port(WORKFLOW, &[]).is_err());
    }

    #[test]
    fn nothing_that_deploys_is_ported() {
        for ported in PORTED {
            for forbidden in ["deploy", "release", "publish", "preview", "migrate"] {
                assert!(
                    !ported.file_name.contains(forbidden),
                    "{} must not run on the forge",
                    ported.file_name
                );
            }
        }
    }
}
