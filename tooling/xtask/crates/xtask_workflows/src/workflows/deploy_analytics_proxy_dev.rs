//! `Deploy analytics proxy dev` — deploys `services/analytics-proxy` to its
//! dev Cloudflare Worker on every push to main that touches it, after
//! installing the worker's server-side ingestion credential from AWS Secrets
//! Manager.

use gh_workflow::{
    Concurrency, Defaults, Event, Job, Level, Permissions, Push, RunDefaults, Step, Workflow,
    WorkflowDispatch,
};

use crate::workflows::actions::{
    ActionsCheckout, ActionsSetupNode, AwsActionsConfigureAwsCredentials, OvenShSetupBun,
};
use crate::workflows::{runners, vars};

/// Build the workflow.
pub fn deploy_analytics_proxy_dev() -> Workflow {
    Workflow::new("Deploy analytics proxy dev")
        .on(Event::default()
            .push(
                Push::default()
                    .add_branch("main")
                    .add_path("services/analytics-proxy/**")
                    .add_path(".github/workflows/deploy-analytics-proxy-dev.yml"),
            )
            .workflow_dispatch(WorkflowDispatch::default()))
        .permissions(Permissions::default().contents(Level::Read))
        .concurrency(Concurrency::new("deploy-analytics-proxy-dev").cancel_in_progress(false))
        .add_job("deploy", deploy())
}

fn deploy() -> Job {
    Job::default()
        .runs_on(runners::Runner::Small.to_string())
        .defaults(
            Defaults::default()
                .run(RunDefaults::default().working_directory("services/analytics-proxy")),
        )
        .add_step(
            ActionsCheckout::new("")
                .persist_credentials(false)
                .step()
                .without_name(),
        )
        .add_step(OvenShSetupBun::new("").step().without_name())
        .add_step(
            ActionsSetupNode::new("")
                .node_version("22")
                .step()
                .without_name(),
        )
        .add_step(
            AwsActionsConfigureAwsCredentials::new("", "us-east-1")
                .aws_access_key_id(vars::AWS_ACCESS_KEY)
                .aws_secret_access_key(vars::AWS_SECRET_ACCESS_KEY)
                .step()
                .without_name(),
        )
        .add_step(
            Step::new("")
                .run("bun install --frozen-lockfile")
                .without_name(),
        )
        .add_step(
            Step::new("")
                .run("bun run gen-types && bun run check")
                .without_name(),
        )
        .add_step(
            Step::new("Set server-side ingestion credential")
                .run(indoc::indoc! {"
                    set -euo pipefail
                    aws secretsmanager get-secret-value --secret-id observability/dev-ingest --query SecretString --output text |
                      bunx wrangler secret put GRAFANA_OTLP_TOKEN --env dev
                "})
                .add_env(("CLOUDFLARE_API_TOKEN", vars::CLOUDFLARE_API_TOKEN))
                .add_env(("CLOUDFLARE_ACCOUNT_ID", vars::CLOUDFLARE_ACCOUNT_ID)),
        )
        .add_step(
            Step::new("Deploy dev proxy")
                .run("bun run deploy-dev")
                .add_env(("CLOUDFLARE_API_TOKEN", vars::CLOUDFLARE_API_TOKEN))
                .add_env(("CLOUDFLARE_ACCOUNT_ID", vars::CLOUDFLARE_ACCOUNT_ID)),
        )
}
