//! `Preview cloud storage pulumi stack`: `pulumi preview` for one service's
//! stack, commenting on the PR when given a token.

use gh_workflow::expr::typed::{Str, input};
use gh_workflow::{ActionInput, CompositeAction, ZizmorRule};

use super::cloud_storage_pulumi::{
    CHECK_LAMBDAS, build_lambdas, check_lambdas, checkout, configure_aws_credentials,
    install_infra_dependencies, login_to_ecr, pulumi, pulumi_step, setup_bun,
};
use crate::workflows::actions::DockerSetupBuildxAction;

pub fn preview_cloud_storage_pulumi() -> CompositeAction {
    let has_service = || input::<Str>("cloud-storage-service-name").ne("");

    CompositeAction::new(
        "Preview cloud storage pulumi stack",
        "Run pulumi preview (dry run) for a pulumi stack from cloud-storage",
    )
    .add_input(
        "use-docker",
        ActionInput::optional("Whether to setup docker", "true"),
    )
    .add_input(
        "use-lfs",
        ActionInput::optional("Whether to checkout LFS content", "false"),
    )
    .add_input(
        "environment",
        ActionInput::optional("Environment to preview", "dev"),
    )
    .add_input("aws-access-key", ActionInput::required("AWS access key"))
    .add_input("aws-secret-key", ActionInput::required("AWS secret key"))
    .add_input(
        "aws-region",
        ActionInput::optional("AWS region", "us-east-1"),
    )
    .add_input(
        "pulumi-access-token",
        ActionInput::required("The access token for pulumi"),
    )
    .add_input(
        "pulumi-service-name",
        ActionInput::required(
            "The name of the pulumi service to preview. This will be the exact name of the \
             folder containing your stacks.",
        ),
    )
    .add_input("dd-app-key", ActionInput::required("Datadog app key"))
    .add_input("dd-api-key", ActionInput::required("Datadog api key"))
    .add_input(
        "dd-host",
        ActionInput::optional("Datadog host", "https://api.us5.datadoghq.com/"),
    )
    .add_input(
        "github-token",
        ActionInput::optional("GitHub token for PR comments", ""),
    )
    .add_input(
        "cloud-storage-service-name",
        ActionInput::optional(
            "Optional service key from .github/services-config.json; used to build Lambda \
             artifacts before preview",
            "",
        ),
    )
    .add_step(checkout().zizmor_ignore(
        ZizmorRule::Artipacked,
        "Pulumi programs and builds run after the checkout",
    ))
    .add_step(check_lambdas("Check Lambda config", has_service()))
    .add_step(build_lambdas(
        "Build Lambda artifacts for preview",
        has_service().and(CHECK_LAMBDAS.outputs.has_lambdas.read().eq("true")),
    ))
    .add_step(
        DockerSetupBuildxAction::new("")
            .step()
            .without_name()
            .if_condition(input::<Str>("use-docker").eq("true")),
    )
    .add_step(setup_bun())
    .add_step(install_infra_dependencies())
    .add_step(configure_aws_credentials())
    .add_step(login_to_ecr())
    .add_step(pulumi_step(
        pulumi("preview")
            .comment_on_pr(input::<Str>("github-token").ne(""))
            .github_token(input::<Str>("github-token")),
    ))
}
