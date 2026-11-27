//! `Observability cluster` — checks the observability EKS cluster's committed
//! manifests on a pull request that changes them: `manifests/prod` must be
//! exactly what the nixidy modules render, and every manifest must validate
//! against the Kubernetes and CRD schemas. Argo CD applies `manifests/prod`
//! from `main`, so a stale or invalid render would ship on merge. `PR CI`
//! calls it when [`PATHS`] change; it holds no credentials. Generated into
//! `observability_cluster.yml`.

use gh_workflow::{Event, Job, Level, Permissions, Step, Workflow, WorkflowCall};
use xtask_paths::RepoGlob;

use crate::workflows::{runners, steps};

const CLUSTER_DIR: &str = "infra/k8s/observability/cluster";

/// The nixidy flake, its modules and its rendered manifests, the single
/// host's files they import (backend settings, Grafana's settings and
/// provisioning, the ingest pipeline), plus this workflow.
pub const PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("infra/k8s/observability/cluster/**"),
    xtask_paths::repo_glob!("infra/stacks/observability/nixos/backend-config.nix"),
    xtask_paths::repo_glob!("infra/stacks/observability/nixos/grafana.nix"),
    xtask_paths::repo_glob!("infra/stacks/observability/nixos/grafana-provisioning/**"),
    xtask_paths::repo_glob!("infra/stacks/observability/nixos/ingest.alloy"),
    xtask_paths::repo_glob!(".github/workflows/observability_cluster.yml"),
];

/// Build the workflow.
pub fn observability_cluster() -> Workflow {
    Workflow::new("Observability cluster")
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default().workflow_call(WorkflowCall::default()))
        .add_job("check-manifests", check_manifests_job())
}

fn check_manifests_job() -> Job {
    Job::default()
        .name("Check rendered manifests")
        .runs_on(runners::Runner::Small.to_string())
        // A cold Nix setup takes up to 9 minutes; rendering pulls five Helm
        // charts and templates them.
        .timeout_minutes(20u32)
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(
            Step::new("Check manifests/prod matches the Nix and validates")
                .run("nix run .#check")
                .shell("bash")
                .working_directory(CLUSTER_DIR),
        )
        .add_step(steps::teardown_nix())
}
