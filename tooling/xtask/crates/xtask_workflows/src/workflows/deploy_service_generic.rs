//! `Deploy Service (Generic)` — manually deploys one service to dev or prod
//! through [`super::reusable_deploy_service`]. A new deployable service adds
//! its name to [`SERVICES`].

use gh_workflow::expr::typed::{Str, input};
use gh_workflow::{CallJob, Concurrency, Event, Workflow, WorkflowDispatch, WorkflowInput};

use crate::workflows::actions::CallReusableDeployService;

/// The services the dispatch form offers, in its order.
const SERVICES: &[&str] = &[
    "agent-harness-service",
    "agent-schedule-service",
    "authentication-service",
    "bulk-upload",
    "calendar-service",
    "connection-gateway",
    "contacts-service",
    "convert-service",
    "deleted-item-poller",
    "dlp-handler",
    "document-cognition-service",
    "document-storage",
    "document-storage-bucket-integrations",
    "document-storage-service",
    "document-text-extractor",
    "email-service",
    "email-suppression",
    "image-proxy-service",
    "lambda-aggregate-frecency",
    "lexical-service",
    "link-sharing",
    "mcp-server",
    "notification-service",
    "organization-retention",
    "search-freshness-probe",
    "search-processing-service",
    "search-upload",
    "static-file-service",
    "unfurl-service",
    "whatsapp-session-service",
    "opensearch",
    "search-event-queue",
    "search-text-extractor-queue",
    "kafka-cluster",
];

/// Build the workflow.
pub fn deploy_service_generic() -> Workflow {
    Workflow::new("Deploy Service (Generic)")
        .on(Event::default().workflow_dispatch(
            WorkflowDispatch::default()
                .add_input(
                    "service",
                    WorkflowInput::choice(SERVICES.iter().copied())
                        .required(true)
                        .description("Select the service to deploy"),
                )
                .add_input(
                    "environment",
                    WorkflowInput::choice(["dev", "prod"])
                        .required(true)
                        .default("dev")
                        .description("The environment to deploy to"),
                ),
        ))
        .concurrency(
            Concurrency::new(format!(
                "deploy-{}-{}",
                input::<Str>("service"),
                input::<Str>("environment")
            ))
            .cancel_in_progress(false),
        )
        .add_job("deploy", deploy())
}

fn deploy() -> CallJob {
    CallReusableDeployService::new(input::<Str>("environment"), input::<Str>("service"))
        .inherit_secrets()
        .job()
        .name(format!("Deploy {}", input::<Str>("service")))
}
