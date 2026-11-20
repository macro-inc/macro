//! `Deploy Observability` — builds the observability host's NixOS image,
//! publishes it as an AMI, smoke-boots it on a throwaway instance and rolls it
//! out to the prod observability stack (`infra/stacks/observability`).
//! Generated into `deploy-observability.yml`.
//!
//! Started by hand only: a rollout replaces the single host, so GoAlert is
//! down for several minutes. `dry_run` (the default)
//! stops before `pulumi up`. Pull requests that change the image build it in
//! `PR CI`, through [`crate::workflows::observability_image`].
//! The steps live in `infra/stacks/observability/deploy/release.ts`; the
//! stack's README ("Deploying") describes them.

use gh_workflow::expr::typed::{Bool, Expr, StepHandle, StepOutput, Str, always, github, input};
use gh_workflow::{
    Concurrency, Event, Job, Level, Permissions, Step, Use, Workflow, WorkflowDispatch,
    WorkflowInput,
};

use crate::workflows::actions::{AwsActionsConfigureAwsCredentials, PulumiActions};
use crate::workflows::{runners, steps, vars};

#[cfg(test)]
mod test;

const STACK_DIR: &str = "infra/stacks/observability";
/// Shared with the PR image build, so a deploy after a PR starts warm.
pub(crate) const CACHE_TAG: &str = "observability-image";
pub(crate) struct FindOutputs {
    /// Which stage this source's image has reached.
    pub stage: StepOutput<Str>,
    /// The AMI already published for this source, if any.
    pub ami: StepOutput<Str>,
    /// The Nix system the image is built for.
    pub system: StepOutput<Str>,
}

/// The step that finds this source's image.
pub(crate) const FIND: StepHandle<FindOutputs> = StepHandle::new(
    "find",
    FindOutputs {
        stage: StepOutput::new("find", "stage"),
        ami: StepOutput::new("find", "ami"),
        system: StepOutput::new("find", "system"),
    },
);

pub(crate) struct PublishOutputs {
    /// The AMI this run published.
    pub ami: StepOutput<Str>,
}

/// The step that publishes the AMI.
pub(crate) const PUBLISH: StepHandle<PublishOutputs> = StepHandle::new(
    "publish",
    PublishOutputs {
        ami: StepOutput::new("publish", "ami"),
    },
);

/// Every step's `if` after `find`: which stage this source's image has reached.
fn stage() -> Expr<Str> {
    FIND.outputs.stage.read()
}

fn ami() -> Expr<Str> {
    PUBLISH.outputs.ami.read().or_else(FIND.outputs.ami.read())
}

/// Build the workflow.
pub fn deploy_observability() -> Workflow {
    Workflow::new("Deploy Observability")
        .on(Event::default().workflow_dispatch(WorkflowDispatch::default().add_input("dry_run", WorkflowInput::boolean().description("Build, publish and smoke-boot the image and preview the rollout, but leave production alone. Untick to replace the host, which takes GoAlert down for several minutes.").required(true).default(true))))
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .add_job("deploy", deploy_job())
}

/// `nix build` of the image. Its builder boots a VM and requires the `kvm`
/// system feature; without `/dev/kvm`, QEMU emulates instead, more slowly.
pub(crate) fn build_image() -> Step<gh_workflow::Run> {
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

pub(crate) fn nix_steps(job: Job) -> Job {
    job.add_step(steps::checkout(false, false))
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
}

/// The deploy credentials every deploy workflow uses, as in `deploy_web_app`.
fn aws_credentials() -> Step<Use> {
    AwsActionsConfigureAwsCredentials::new("Configure AWS credentials", "us-east-2")
        .aws_access_key_id(vars::AWS_ACCESS_KEY)
        .aws_secret_access_key(vars::AWS_SECRET_ACCESS_KEY)
        .step()
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
        .runs_on(runners::Runner::Mid.with_cache_tag(CACHE_TAG))
        .timeout_minutes(180u32)
        // One rollout at a time, and never cancel one: that could leave the
        // stack mid-replacement. A queued run waits for the running one.
        .concurrency(Concurrency::new("deploy-observability-prod").cancel_in_progress(false))
        .add_env(("PULUMI_ACCESS_TOKEN", vars::PULUMI_ACCESS_TOKEN))
        .add_step(
            Step::new("Refuse branches other than main")
                .run(indoc::indoc! {r#"
                    if [ "$GITHUB_REF" != refs/heads/main ]; then
                      echo "::error::Deploy observability from main"
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
        .add_step(PulumiActions::new("Install Pulumi"))
        .add_step(
            release(
                "Refuse a commit older than main's last stack change",
                "latest",
            )
            .add_env(("GITHUB_TOKEN", github().token())),
        )
        .add_step(aws_credentials())
        .add_step(release("Find this source's image", "find").id(FIND.id()))
        .add_step(build_image().if_condition(stage().eq("build")))
        .add_step(
            release("Publish the AMI", "publish")
                .id(PUBLISH.id())
                .if_condition(stage().eq("build"))
                .add_env(("NIX_SYSTEM", FIND.outputs.system.read())),
        )
        .add_step(
            release("Smoke-boot the AMI on a throwaway host", "smoke")
                .if_condition(stage().ne("deploy"))
                .add_env(("AMI", ami())),
        )
        .add_step(
            release("Check the plan and roll out", "deploy")
                .add_env(("AMI", ami()))
                .add_env(("DRY_RUN", input::<Bool>("dry_run"))),
        )
        .add_step(
            release("Remove smoke resources a cancelled run left", "cleanup")
                .if_condition(always().and(stage().ne("")).and(stage().ne("deploy"))),
        )
        .add_step(steps::teardown_nix())
}
