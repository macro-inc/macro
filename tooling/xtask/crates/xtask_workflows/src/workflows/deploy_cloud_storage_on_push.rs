//! `Deploy Cloud Storage Services on Push` — thin trigger: every push to main
//! touching the Rust services (or the deploy machinery) deploys all services
//! to dev via the shared [`crate::workflows::deploy_all_services`] pipeline —
//! the same warm sticky-disk nix builds, crane/zigbuild lambdas, and handoff
//! topology used by manual dispatches and prod releases. Generated into
//! `deploy_cloud_storage_on_push.yml` (replaces the hand-written
//! `deploy-cloud-storage-on-push.yml`; keep
//! [`crate::workflows::cancel_stuck_cloud_storage_deploys`]'s `WORKFLOW_FILE`
//! in sync with this filename).
//!
//! NOTE: deliberately no concurrency block here. The called workflow's own
//! top-level group (`deploy-all-services-${{ inputs.environment }}`) IS
//! honored for workflow_call runs and is what serializes push deploys against
//! manual dev dispatches (running deploys finish; queued pushes coalesce to
//! the newest). Declaring the same group in this wrapper makes GitHub detect
//! a self-deadlock ("between a top level workflow and ...") and cancel the
//! run.

use anyhow::Result;
use gh_workflow::{Event, Job, Push, Workflow};

/// Build the workflow. The caller job's `with:`/`secrets:` are filled in by
/// [`patch`].
pub fn deploy_cloud_storage_on_push() -> Workflow {
    Workflow::new("Deploy Cloud Storage Services on Push")
        .on(Event::default().push(
            Push::default()
                .add_branch("main")
                .add_path(xtask_paths::repo_glob!("Cargo.toml"))
                .add_path(xtask_paths::repo_glob!("Cargo.lock"))
                .add_path(xtask_paths::repo_glob!("Cross.toml"))
                .add_path(xtask_paths::repo_glob!("clippy.toml"))
                .add_path(xtask_paths::repo_glob!("deny.toml"))
                .add_path(xtask_paths::repo_glob!("rust-toolchain.toml"))
                .add_path(xtask_paths::repo_glob!(".cargo/**"))
                .add_path(xtask_paths::repo_glob!(".config/**"))
                .add_path(xtask_paths::repo_glob!(".sqlx/**"))
                .add_path(xtask_paths::repo_glob!("crates/**"))
                .add_path(xtask_paths::repo_glob!("services/**"))
                .add_path(xtask_paths::repo_glob!("tooling/xtask/**"))
                .add_path(xtask_paths::repo_glob!("tooling/just/**"))
                .add_path(xtask_paths::repo_glob!("tooling/scripts/**"))
                .add_path(xtask_paths::repo_glob!("static_assets/**"))
                .add_path(xtask_paths::repo_glob!("docker/**"))
                .add_path(xtask_paths::repo_glob!("nix/**"))
                .add_path(xtask_paths::repo_glob!("nix-support/**"))
                .add_path(xtask_paths::repo_glob!("infra/**"))
                .add_path(xtask_paths::repo_glob!(
                    ".github/workflows/deploy_cloud_storage_on_push.yml"
                ))
                .add_path(xtask_paths::repo_glob!(
                    ".github/workflows/deploy_all_services.yml"
                ))
                .add_path(xtask_paths::repo_glob!(
                    ".github/actions/deploy-cloud-storage-pulumi/**"
                ))
                .add_path(xtask_paths::repo_glob!(".github/actions/setup-nix/**"))
                .add_path(xtask_paths::repo_glob!(".github/actions/teardown-nix/**"))
                .add_path(xtask_paths::repo_glob!(".github/actions/setup-cachix/**"))
                .add_path(xtask_paths::repo_glob!(
                    ".github/actions/migrate-cloud-storage-db/**"
                ))
                .add_path(xtask_paths::repo_glob!(
                    ".github/scripts/build-cloud-storage-lambdas-nix.sh"
                ))
                .add_path(xtask_paths::repo_glob!(".github/services-config.json"))
                .add_path(xtask_paths::repo_glob!(
                    ".github/workspace-dep-closures.json"
                ))
                .add_path(xtask_paths::repo_glob!("flake.nix"))
                .add_path(xtask_paths::repo_glob!("flake.lock")),
        ))
        .add_job("deploy-all", deploy_all())
}

/// Add the caller job's `with:` and explicit `secrets:` map, and drop the
/// `runs-on` that `Job::default()` injects (invalid alongside `uses:`).
pub fn patch(root: &mut serde_yaml::Value) -> Result<()> {
    let job = crate::workflows::job_mut(root, "deploy-all")?;
    job.remove("runs-on");
    job.insert(
        "with".into(),
        crate::workflows::yaml_fragment("environment: dev")?,
    );
    job.insert(
        "secrets".into(),
        crate::workflows::yaml_fragment(indoc::indoc! {r#"
            AWS_ACCESS_KEY: ${{ secrets.AWS_ACCESS_KEY }}
            AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
            PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
            DD_APP_KEY: ${{ secrets.DD_APP_KEY }}
            DD_API_KEY: ${{ secrets.DD_API_KEY }}
            CACHIX_AUTH_TOKEN: ${{ secrets.CACHIX_AUTH_TOKEN }}
        "#})?,
    );
    Ok(())
}

fn deploy_all() -> Job {
    Job::default()
        .name("Deploy Cloud Storage Services")
        .uses("./.github/workflows/deploy_all_services.yml")
}
