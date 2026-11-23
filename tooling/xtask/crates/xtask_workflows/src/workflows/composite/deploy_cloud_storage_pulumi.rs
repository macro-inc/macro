//! `Deploy cloud storage pulumi stack`: `pulumi up` for one service's stack,
//! with its prebuilt binaries and Lambda artifacts in place.

use gh_workflow::expr::typed::{Str, input};
use gh_workflow::{ActionInput, CompositeAction, Step, ZizmorRule};

use super::cloud_storage_pulumi::{
    CHECK_LAMBDAS, build_lambdas, check_lambdas, checkout, configure_aws_credentials,
    install_infra_dependencies, login_to_ecr, pulumi, pulumi_step, setup_bun,
};
use crate::workflows::actions::{
    ActionsDownloadArtifact, DockerSetupBuildxAction, NamespacelabsNscloudSetupBuildxAction,
};

pub fn deploy_cloud_storage_pulumi() -> CompositeAction {
    let has_binaries_artifact = || input::<Str>("prebuilt-binaries-artifact").ne("");
    let has_binaries_tar = || input::<Str>("prebuilt-binaries-tar").ne("");
    let has_lambdas_artifact = || input::<Str>("lambda-artifacts").ne("");
    let has_lambdas_tar = || input::<Str>("lambda-artifacts-tar").ne("");

    // Without handed-off Lambda artifacts, a named service builds its own.
    let build_lambdas_inline = || {
        input::<Str>("lambda-artifacts")
            .eq("")
            .and(input::<Str>("lambda-artifacts-tar").eq(""))
            .and(input::<Str>("cloud-storage-service-name").ne(""))
    };

    let use_docker = || input::<Str>("use-docker").eq("true");

    CompositeAction::new(
        "Deploy cloud storage pulumi stack",
        "Deploy a pulumi stack from cloud-storage pulumi",
    )
    .add_input(
        "use-docker",
        ActionInput::optional("Whether to setup docker", "true"),
    )
    .add_input(
        "use-namespace-builder",
        ActionInput::optional(
            "Use a Namespace remote Docker builder (persistent layer cache, so heavy bases \
             like LibreOffice/Collabora stay warm across deploys). Requires the nsc CLI \
             (preinstalled on Namespace runners); defaults to the stock \
             docker/setup-buildx-action.",
            "false",
        ),
    )
    .add_input(
        "use-lfs",
        ActionInput::optional("Whether to checkout LFS content", "false"),
    )
    .add_input(
        "environment",
        ActionInput::optional("Environment to deploy to", "dev"),
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
            "The name of the pulumi service to deploy. This will be the exact name of the \
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
        "prebuilt-binaries-artifact",
        ActionInput::optional(
            "Optional GitHub artifact containing prebuilt service binaries to copy into \
             Docker images",
            "",
        ),
    )
    .add_input(
        "lambda-artifacts",
        ActionInput::optional(
            "Optional GitHub artifact containing built Lambda artifacts under target/lambda",
            "",
        ),
    )
    .add_input(
        "prebuilt-binaries-tar",
        ActionInput::optional(
            "Optional path to a prebuilt-binaries.tar.gz already present on disk (e.g. \
             downloaded from Namespace artifact storage). When set, takes precedence over \
             prebuilt-binaries-artifact and skips the GitHub artifact download.",
            "",
        ),
    )
    .add_input(
        "lambda-artifacts-tar",
        ActionInput::optional(
            "Optional path to a lambda-artifacts.tar.gz already present on disk (e.g. \
             downloaded from Namespace artifact storage). When set, takes precedence over \
             lambda-artifacts and skips the GitHub artifact download.",
            "",
        ),
    )
    .add_input(
        "cloud-storage-service-name",
        ActionInput::optional(
            "Optional service key from .github/services-config.json; builds Lambda \
             artifacts inline when lambda-artifacts is not provided",
            "",
        ),
    )
    .add_step(checkout().zizmor_ignore(
        ZizmorRule::Artipacked,
        "Pulumi programs and builds run after the checkout",
    ))
    .add_step(
        ActionsDownloadArtifact::new("Download prebuilt service binaries")
            .name(input::<Str>("prebuilt-binaries-artifact"))
            .path("prebuilt-artifact")
            .step()
            .if_condition(has_binaries_artifact()),
    )
    .add_step(
        Step::new("Extract prebuilt service binaries")
            .run(include_str!(
                "deploy_cloud_storage_pulumi/extract_prebuilt_binaries.sh"
            ))
            .if_condition(has_binaries_artifact().or(has_binaries_tar()))
            .shell("bash")
            .add_env(("TAR_PATH", input::<Str>("prebuilt-binaries-tar"))),
    )
    .add_step(
        ActionsDownloadArtifact::new("Download Lambda artifacts")
            .name(input::<Str>("lambda-artifacts"))
            .path("lambda-artifact")
            .step()
            .if_condition(has_lambdas_artifact()),
    )
    .add_step(
        Step::new("Extract Lambda artifacts")
            .run(include_str!(
                "deploy_cloud_storage_pulumi/extract_lambda_artifacts.sh"
            ))
            .if_condition(has_lambdas_artifact().or(has_lambdas_tar()))
            .shell("bash")
            .add_env(("TAR_PATH", input::<Str>("lambda-artifacts-tar"))),
    )
    .add_step(check_lambdas(
        "Check Lambda config for inline build",
        build_lambdas_inline(),
    ))
    .add_step(build_lambdas(
        "Build Lambda artifacts inline",
        build_lambdas_inline().and(CHECK_LAMBDAS.outputs.has_lambdas.read().eq("true")),
    ))
    // A Namespace remote builder keeps a persistent BuildKit layer cache, so
    // heavy bases like LibreOffice/Collabora stay warm across runs instead of
    // being pulled from ECR each time; otherwise the stock buildx builder.
    // Pulumi's docker-build provider uses whichever is the default builder.
    .add_step(
        NamespacelabsNscloudSetupBuildxAction::new("Set up Namespace Docker builder")
            .step()
            .if_condition(use_docker().and(input::<Str>("use-namespace-builder").eq("true"))),
    )
    .add_step(
        DockerSetupBuildxAction::new("")
            .step()
            .without_name()
            .if_condition(use_docker().and(input::<Str>("use-namespace-builder").ne("true"))),
    )
    .add_step(setup_bun())
    .add_step(install_infra_dependencies())
    .add_step(configure_aws_credentials())
    .add_step(login_to_ecr())
    .add_step(
        // `upsert` creates the stack on a new service's first deploy.
        pulumi_step(pulumi("up").upsert(true)).add_env((
            "USE_PREBUILT_SERVICE_BINARIES",
            has_binaries_artifact()
                .or(has_binaries_tar())
                .then_else("true", "false"),
        )),
    )
}
