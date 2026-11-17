//! Steps the deploy and preview cloud-storage Pulumi actions share. Each reads
//! the inputs both actions declare under the same names.

use gh_workflow::expr::typed::{Bool, Expr, StepHandle, StepOutput, Str, input};
use gh_workflow::{Run, Step, Use};

use crate::workflows::actions::{
    ActionsCheckout, AwsActionsConfigureAwsCredentials, OvenShSetupBun, PulumiActions,
};

pub(super) struct CheckLambdasOutputs {
    pub has_lambdas: StepOutput<Str>,
}

/// The step [`check_lambdas`] adds.
pub(super) const CHECK_LAMBDAS: StepHandle<CheckLambdasOutputs> = StepHandle::new(
    "check-lambdas",
    CheckLambdasOutputs {
        has_lambdas: StepOutput::new("check-lambdas", "has_lambdas"),
    },
);

/// The repository, with LFS content when `use-lfs` is `true`.
pub(super) fn checkout() -> Step<Use> {
    ActionsCheckout::new("")
        .lfs(input::<Str>("use-lfs"))
        .step()
        .without_name()
}

/// Whether `cloud-storage-service-name` deploys any Lambdas, as
/// [`CHECK_LAMBDAS`]'s `has_lambdas`.
pub(super) fn check_lambdas(name: &str, condition: Expr<Bool>) -> Step<Run> {
    Step::new(name)
        .run(
            "has_lambdas=$(jq -r --arg service \"$SERVICE\" '((.services[$service].deploy_lambdas // []) | length) > 0' .github/services-config.json)\n\
             echo \"has_lambdas=$has_lambdas\" >> \"$GITHUB_OUTPUT\"\n",
        )
        .if_condition(condition)
        .id(CHECK_LAMBDAS.id())
        .shell("bash")
        .add_env(service())
}

/// Build `cloud-storage-service-name`'s Lambdas into `target/lambda`.
pub(super) fn build_lambdas(name: &str, condition: Expr<Bool>) -> Step<Run> {
    Step::new(name)
        .run(
            ".github/scripts/build-cloud-storage-lambdas-nix.sh\n\
             rm -rf target/lambda\n\
             tar -xzf lambda-artifacts.tar.gz -C .\n",
        )
        .if_condition(condition)
        .shell("bash")
        .add_env(service())
}

fn service() -> (&'static str, Expr<Str>) {
    ("SERVICE", input::<Str>("cloud-storage-service-name"))
}

pub(super) fn setup_bun() -> Step<Use> {
    OvenShSetupBun::new("")
        .bun_version("1.2.0")
        .step()
        .without_name()
}

pub(super) fn install_infra_dependencies() -> Step<Run> {
    Step::new("install infra dependencies")
        .run("cd infra \nbun install\n")
        .shell("bash")
}

pub(super) fn configure_aws_credentials() -> Step<Use> {
    AwsActionsConfigureAwsCredentials::new("", input::<Str>("aws-region"))
        .aws_access_key_id(input::<Str>("aws-access-key"))
        .aws_secret_access_key(input::<Str>("aws-secret-key"))
        .step()
        .without_name()
}

/// Log Docker in to ECR, so Pulumi can pull the services' images as build
/// caches.
pub(super) fn login_to_ecr() -> Step<Run> {
    Step::new("login to ecr")
        .run("aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 569036502058.dkr.ecr.us-east-1.amazonaws.com\n")
        .shell("bash")
}

/// `pulumi/actions` running `command` on the `macro-inc/<environment>` stack
/// of `infra/stacks/<pulumi-service-name>`.
pub(super) fn pulumi(command: &str) -> PulumiActions {
    PulumiActions::new("")
        .command(command)
        .stack_name(format!("macro-inc/{}", input::<Str>("environment")))
        .work_dir(format!(
            "./infra/stacks/{}",
            input::<Str>("pulumi-service-name")
        ))
}

/// [`pulumi`] as a step, with the Pulumi and Datadog credentials in its
/// environment.
pub(super) fn pulumi_step(action: PulumiActions) -> Step<Use> {
    action
        .step()
        .without_name()
        .add_env(("PULUMI_ACCESS_TOKEN", input::<Str>("pulumi-access-token")))
        .add_env(("DD_APP_KEY", input::<Str>("dd-app-key")))
        .add_env(("DD_API_KEY", input::<Str>("dd-api-key")))
        .add_env(("DD_HOST", input::<Str>("dd-host")))
}
