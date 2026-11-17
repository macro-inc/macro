//! `Deploy FusionAuth Instance` — manually deploys the FusionAuth instance
//! configuration Pulumi stack to dev or prod through the shared single-service
//! deployment workflow. Generated into `deploy_fusionauth_instance.yml`.

use gh_workflow::expr::typed::{Str, input};
use gh_workflow::{CallJob, Concurrency, Event, Workflow, WorkflowDispatch, WorkflowInput};

/// Build the workflow.
pub fn deploy_fusionauth_instance() -> Workflow {
    Workflow::new("Deploy FusionAuth Instance")
        .on(Event::default().workflow_dispatch(
            WorkflowDispatch::default().add_input(
                "environment",
                WorkflowInput::choice(["dev", "prod"])
                    .description("The environment to deploy to.")
                    .required(true)
                    .default("dev"),
            ),
        ))
        .concurrency(
            Concurrency::new(format!(
                "deploy-fusionauth-instance-{}",
                input::<Str>("environment")
            ))
            .cancel_in_progress(false),
        )
        .add_job("deploy", deploy())
}

fn deploy() -> CallJob {
    CallJob::new("./.github/workflows/reusable_deploy_service.yml")
        .name("Deploy fusionauth-instance")
        .add_with("environment", input::<Str>("environment"))
        .add_with("service-name", "fusionauth-instance")
        .add_with("pulumi-stack-name", "fusionauth-instance")
        .add_with("use-docker", false)
        .inherit_secrets()
}
