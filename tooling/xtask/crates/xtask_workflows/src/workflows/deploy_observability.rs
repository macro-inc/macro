//! `Deploy Observability` — builds the observability host's NixOS image,
//! publishes it as an AMI, smoke-boots it on a throwaway instance and rolls it
//! out to the prod observability stack (`infra/stacks/observability`).
//! Generated into `deploy-observability.yml`.
//!
//! Started by hand only: a rollout replaces the single host, so Grafana, Loki,
//! Tempo and GoAlert are down for several minutes. `dry_run` (the default)
//! stops before `pulumi up`. Pull requests that change the image only build it.
//! The steps live in `infra/stacks/observability/deploy/release.ts`; the
//! stack's README ("Deploying") describes them.

use anyhow::Result;
use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, PullRequest, Step, Use, Workflow,
    WorkflowDispatch,
};

use crate::workflows::{runners, steps, vars};

#[cfg(test)]
mod test;

const STACK_DIR: &str = "infra/stacks/observability";
const DEPLOY_ROLE: &str = "arn:aws:iam::569036502058:role/macro-observability-deploy";
const CACHE_TAG: &str = "observability-image";
/// Every step's `if` after `find`: which stage this source's image has reached.
const STAGE: &str = "steps.find.outputs.stage";
const AMI: &str = "${{ steps.publish.outputs.ami || steps.find.outputs.ami }}";

/// Build the workflow. The ordered dispatch input is filled in by [`patch`].
pub fn deploy_observability() -> Workflow {
    let mut pull_request = PullRequest::default().add_branch("main");
    for path in [
        xtask_paths::repo_glob!("infra/stacks/observability/flake.nix"),
        xtask_paths::repo_glob!("infra/stacks/observability/flake.lock"),
        xtask_paths::repo_glob!("infra/stacks/observability/nixos/**"),
        xtask_paths::repo_glob!("infra/stacks/observability/assets/**"),
        xtask_paths::repo_glob!(".github/workflows/deploy-observability.yml"),
    ] {
        pull_request = pull_request.add_path(path);
    }
    Workflow::new("Deploy Observability")
        .on(Event::default()
            .workflow_dispatch(WorkflowDispatch::default())
            .pull_request(pull_request))
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .add_job("build-image", build_image_job())
        .add_job("deploy", deploy_job())
}

/// The `dry_run` input: a boolean defaulting to true, so a deploy is a choice.
pub fn patch(root: &mut serde_yaml::Value) -> Result<()> {
    let on = root
        .get_mut("on")
        .and_then(serde_yaml::Value::as_mapping_mut)
        .ok_or_else(|| anyhow::anyhow!("rendered workflow has no `on` mapping"))?;
    on.insert(
        "workflow_dispatch".into(),
        crate::workflows::yaml_fragment(indoc::indoc! {r#"
            inputs:
              dry_run:
                type: boolean
                required: true
                default: true
                description: >-
                  Build, publish and smoke-boot the image and preview the rollout,
                  but leave production alone. Untick to replace the host, which
                  takes Grafana, Loki, Tempo and GoAlert down for several minutes.
        "#})?,
    );
    Ok(())
}

/// `nix build` of the image. Its builder boots a VM and requires the `kvm`
/// system feature; without `/dev/kvm`, QEMU emulates instead, more slowly.
fn build_image() -> Step<gh_workflow::Run> {
    Step::new("Build the NixOS image")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            if [ -e /dev/kvm ]; then
              echo "KVM is available"
            else
              echo "::warning::No /dev/kvm: the image builds under QEMU emulation"
            fi
            features="$(nix config show system-features) kvm"
            time nix build . --option system-features "$features" --print-build-logs --out-link result
            du -shL result/*.vhd
        "#})
        .shell("bash")
        .working_directory(STACK_DIR)
}

fn nix_steps(job: Job) -> Job {
    job.add_step(steps::checkout(false, false))
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
}

/// Proves an image change builds before it merges. No credentials.
fn build_image_job() -> Job {
    nix_steps(
        Job::default()
            .name("Build observability image")
            .cond(Expression::new("github.event_name == 'pull_request'"))
            .runs_on(runners::Runner::Mid.with_cache_tag(CACHE_TAG))
            .timeout_minutes(90u32)
            .concurrency(
                Concurrency::new(Expression::new(
                    "observability-image-${{ github.event.pull_request.number }}",
                ))
                .cancel_in_progress(true),
            ),
    )
    .add_step(build_image())
    .add_step(steps::teardown_nix())
}

fn assume_role(name: &str, seconds: u32) -> Step<Use> {
    Step::new(name)
        .uses(
            "aws-actions",
            "configure-aws-credentials",
            "e7f100cf4c008499ea8adda475de1042d6975c7b",
        )
        .add_with(("role-to-assume", DEPLOY_ROLE))
        .add_with(("aws-region", "us-east-2"))
        .add_with(("role-duration-seconds", seconds))
}

fn release(name: &str, command: &str) -> Step<gh_workflow::Run> {
    Step::new(name)
        .run(format!("bun deploy/release.ts {command}"))
        .shell("bash")
        .working_directory(STACK_DIR)
}

fn deploy_job() -> Job {
    let job = Job::default()
        .name("Deploy observability")
        .cond(Expression::new("github.event_name == 'workflow_dispatch'"))
        .runs_on(runners::Runner::Mid.with_cache_tag(CACHE_TAG))
        .timeout_minutes(180u32)
        .permissions(Permissions {
            contents: Some(Level::Read),
            id_token: Some(Level::Write),
            ..Default::default()
        })
        // One rollout at a time, and never cancel one: that could leave the
        // stack mid-replacement. A queued run waits for the running one.
        .concurrency(
            Concurrency::new(Expression::new("deploy-observability-prod"))
                .cancel_in_progress(false),
        )
        .add_env(("PULUMI_ACCESS_TOKEN", vars::PULUMI_ACCESS_TOKEN))
        .add_step(
            Step::new("Refuse branches other than main")
                .run(indoc::indoc! {r#"
                    if [ "$GITHUB_REF" != refs/heads/main ]; then
                      echo "::error::Deploy observability from main; the deploy role trusts only main"
                      exit 1
                    fi
                "#})
                .shell("bash"),
        );
    nix_steps(job)
        .add_step(steps::setup_bun_pinned())
        .add_step(
            Step::new("Install infra dependencies")
                .run("bun install --frozen-lockfile")
                .shell("bash")
                .working_directory("infra"),
        )
        .add_step(Step::new("Install Pulumi").uses(
            "pulumi",
            "actions",
            "8e5e406f4007fca908480587cb9893c07090f58d",
        ))
        .add_step(
            release(
                "Refuse a commit older than main's last stack change",
                "latest",
            )
            .add_env(("GITHUB_TOKEN", "${{ github.token }}")),
        )
        .add_step(assume_role("Assume the deploy role", 900))
        .add_step(release("Find this source's image", "find").id("find"))
        .add_step(build_image().if_condition(Expression::new(format!("{STAGE} == 'build'"))))
        // A VM import can take most of an hour.
        .add_step(
            assume_role("Assume the deploy role to publish", 7200)
                .if_condition(Expression::new(format!("{STAGE} != 'deploy'"))),
        )
        .add_step(
            release("Publish the AMI", "publish")
                .id("publish")
                .if_condition(Expression::new(format!("{STAGE} == 'build'")))
                .add_env(("NIX_SYSTEM", "${{ steps.find.outputs.system }}")),
        )
        .add_step(
            release("Smoke-boot the AMI on a throwaway host", "smoke")
                .if_condition(Expression::new(format!("{STAGE} != 'deploy'")))
                .add_env(("AMI", AMI)),
        )
        .add_step(assume_role("Assume the deploy role to roll out", 3600))
        .add_step(
            release("Check the plan and roll out", "deploy")
                .add_env(("AMI", AMI))
                .add_env(("DRY_RUN", "${{ inputs.dry_run }}")),
        )
        .add_step(
            release("Remove a smoke host a cancelled run left", "cleanup").if_condition(
                Expression::new(format!("always() && {STAGE} != '' && {STAGE} != 'deploy'")),
            ),
        )
        .add_step(steps::teardown_nix())
}
