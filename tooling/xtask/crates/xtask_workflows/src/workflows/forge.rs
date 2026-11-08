//! The self-hosted forge's CI: `.gitea/workflows/`, derived from the generated
//! GitHub workflows.
//!
//! The forge reads only `.gitea/workflows/` (`WORKFLOW_DIRS` in
//! infra/platform/cluster.nix), so this allowlist is everything that can run there.
//! Deploy, release, and publish workflows are left out on purpose, as are native
//! builds that need macOS or Windows runners and checks that call GitHub's own API.

use anyhow::{Context, Result, ensure};
use serde_yaml::Value;

/// `actions/cache` v4, which the forge runner's cache server speaks.
const CACHE_ACTION: &str = "actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830";

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
        // Doppler's reads production-scoped configs, and the status job requires it.
        dropped_jobs: &["doppler-config", "status-check"],
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
        file_name: "platform_parity.yml",
        dropped_jobs: &[],
    },
    Ported {
        file_name: "sdk-check.yml",
        dropped_jobs: &[],
    },
    Ported {
        file_name: "web-app-check-main.yml",
        // iOS needs a macOS runner; Android calls GitHub's CLI and Google's auth. The
        // status job requires the Android result; each remaining job reports itself.
        dropped_jobs: &["ios-native-check", "android-native-check", "status-check"],
    },
];

/// Rewrite one rendered GitHub workflow for the forge: its runner label, no
/// Namespace cache volumes (the runner keeps its own), none of `dropped`, and no
/// preview deploy. GitHub calls these workflows from `PR CI`; the forge has neither its
/// label nor its gate, so each runs on pull requests touching `paths`, or any if empty,
/// with Gitea's default activity types. Each job first puts Cargo's bin directory on
/// PATH, which hosted runners do and the job image does not. `dorny/paths-filter`
/// gets no token, so it diffs with git instead of asking GitHub's API, and its job
/// checks out full history for that. Checkouts keep their credentials, because the
/// mirror is private and some jobs fetch from it later.
pub fn port(yaml: &str, dropped: &[&str], paths: &[String]) -> Result<String> {
    let mut root: Value = serde_yaml::from_str(yaml).context("parsing workflow")?;
    let mut pull_request = serde_yaml::Mapping::new();
    if !paths.is_empty() {
        pull_request.insert(Value::from("paths"), Value::from(paths.to_vec()));
    }
    let mut on = serde_yaml::Mapping::new();
    on.insert(Value::from("pull_request"), Value::Mapping(pull_request));
    let root_map = root.as_mapping_mut().context("workflow is not a mapping")?;
    root_map.insert(Value::from("on"), Value::Mapping(on));
    // A new push supersedes the branch's runs, as `PR CI`'s group does on GitHub;
    // otherwise two runners work through every superseded commit first.
    root_map.insert(
        Value::from("concurrency"),
        serde_yaml::from_str(
            "{ group: '${{ github.workflow }}-${{ github.head_ref || github.ref }}', \
             cancel-in-progress: true }",
        )
        .context("parsing the concurrency group")?,
    );
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
            // Namespace keeps these paths on a volume across runs; the forge's runner
            // cache keeps the home-directory ones instead. Vitest's module cache is what
            // keeps lazily imported components inside a test's time limit. The jobs'
            // `/nix` is already a volume every job shares, and build output is too large
            // to archive per job.
            for step in steps.iter_mut() {
                let namespace = step
                    .get("uses")
                    .and_then(Value::as_str)
                    .is_some_and(|uses| uses.starts_with("namespacelabs/nscloud-cache-action"));
                let path = namespace
                    .then(|| step.get("with").and_then(|with| with.get("path")))
                    .flatten()
                    .and_then(Value::as_str)
                    .map(|paths| {
                        paths
                            .lines()
                            .map(str::trim)
                            .filter(|path| path.starts_with("/home/runner/"))
                            .collect::<Vec<_>>()
                            .join("\n")
                    })
                    .filter(|paths| !paths.is_empty());
                if let Some(path) = path {
                    *step = serde_yaml::from_str(&format!(
                        "{{ name: Restore caches, uses: '{CACHE_ACTION}', continue-on-error: true }}"
                    ))
                    .context("parsing the cache step")?;
                    let mut with = serde_yaml::Mapping::new();
                    with.insert(Value::from("path"), Value::from(path));
                    // A new copy only when dependencies change, not on every run.
                    with.insert(
                        Value::from("key"),
                        Value::from(format!(
                            "forge-{name}-${{{{ hashFiles('**/bun.lock', '**/Cargo.lock') }}}}"
                        )),
                    );
                    with.insert(
                        Value::from("restore-keys"),
                        Value::from(format!("forge-{name}-")),
                    );
                    step.as_mapping_mut()
                        .context("cache step is not a mapping")?
                        .insert(Value::from("with"), Value::Mapping(with));
                }
            }
            steps.retain(|step| {
                let field = |key: &str| step.get(key).and_then(Value::as_str).unwrap_or_default();
                !(field("uses").starts_with("namespacelabs/nscloud-cache-action")
                    || field("id").starts_with("preview")
                    || field("run").contains("scripts/preview/"))
            });
            let uses = |step: &Value, action: &str| {
                step.get("uses")
                    .and_then(Value::as_str)
                    .is_some_and(|uses| uses.starts_with(action))
            };
            for step in steps.iter_mut() {
                if uses(step, "actions/checkout")
                    && let Some(with) = step.get_mut("with").and_then(Value::as_mapping_mut)
                {
                    with.remove("persist-credentials");
                }
            }
            if steps.iter().any(|step| uses(step, "dorny/paths-filter")) {
                for step in steps.iter_mut() {
                    let (key, value) = if uses(step, "dorny/paths-filter") {
                        ("token", "")
                    } else if uses(step, "actions/checkout") {
                        ("fetch-depth", "0")
                    } else {
                        continue;
                    };
                    if let Some(with) = step
                        .as_mapping_mut()
                        .map(|step| {
                            step.entry(Value::from("with"))
                                .or_insert_with(|| Value::Mapping(Default::default()))
                        })
                        .and_then(Value::as_mapping_mut)
                    {
                        with.insert(Value::from(key), Value::from(value));
                    }
                }
            }
        }
    }
    serde_yaml::to_string(&root).context("serializing ported workflow")
}

#[cfg(test)]
mod test {
    use super::*;

    const WORKFLOW: &str = r#"
on:
  workflow_call: {}
jobs:
  build:
    needs: [paths, ios]
    runs-on: namespace-profile-linux-small;overrides.cache-tag=web-ci
    steps:
    - uses: namespacelabs/nscloud-cache-action@abc
      with:
        path: |-
          /nix
          ./target
          /home/runner/.cache/vitest-modules
    - uses: namespacelabs/nscloud-cache-action@abc
      with:
        path: /nix
    - uses: actions/checkout@abc
    - id: preview-credentials
      uses: aws-actions/configure-aws-credentials@abc
    - name: Comment on PR
      run: bun scripts/preview/post-comment.ts
  paths:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@abc
      with:
        persist-credentials: 'false'
    - uses: dorny/paths-filter@abc
  ios:
    runs-on: nscloud-macos-sequoia-arm64-6x14
"#;

    #[test]
    fn port_rewrites_runners_and_drops_namespace_caches_and_jobs() {
        let paths = ["a/**".to_owned()];
        let ported: Value =
            serde_yaml::from_str(&port(WORKFLOW, &["ios"], &paths).unwrap()).unwrap();
        let build = &ported["jobs"]["build"];
        assert_eq!(build["runs-on"], RUNNER_LABEL);
        assert_eq!(build["needs"].as_sequence().unwrap().len(), 1);
        assert_eq!(build["steps"].as_sequence().unwrap().len(), 3);
        assert_eq!(build["steps"][0]["name"], "Put Cargo on PATH");
        let cache = &build["steps"][1];
        assert_eq!(cache["uses"], CACHE_ACTION);
        assert_eq!(cache["with"]["path"], "/home/runner/.cache/vitest-modules");
        assert_eq!(
            cache["with"]["key"],
            "forge-build-${{ hashFiles('**/bun.lock', '**/Cargo.lock') }}"
        );
        assert_eq!(cache["with"]["restore-keys"], "forge-build-");
        assert!(ported["jobs"].get("ios").is_none());
        let paths = &ported["jobs"]["paths"]["steps"];
        assert_eq!(paths[1]["with"]["fetch-depth"], "0");
        assert!(paths[1]["with"].get("persist-credentials").is_none());
        assert_eq!(paths[2]["with"]["token"], "");
        assert!(paths[0].get("with").is_none());
        assert!(ported["on"].get("workflow_call").is_none());
        assert_eq!(ported["concurrency"]["cancel-in-progress"], true);
        assert_eq!(ported["on"]["pull_request"]["paths"][0], "a/**");
    }

    #[test]
    fn port_refuses_jobs_the_runners_cannot_serve() {
        assert!(port(WORKFLOW, &[], &[]).is_err());
    }

    #[test]
    fn no_ported_workflow_holds_cloud_credentials_or_previews() {
        for ported in PORTED {
            let rendered = crate::workflows::render_forge(ported).unwrap();
            for forbidden in ["aws-actions/", "scripts/preview/", "needs.doppler-config"] {
                assert!(
                    !rendered.contains(forbidden),
                    "{} holds `{forbidden}`",
                    ported.file_name
                );
            }
        }
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
