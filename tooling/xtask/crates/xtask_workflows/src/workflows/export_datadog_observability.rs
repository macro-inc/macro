//! `Export Datadog observability definitions` — manually reads the live
//! Datadog dashboards and monitors into an artifact, for the observability
//! migration (`infra/stacks/observability/migration`).

use gh_workflow::expr::typed::always;
use gh_workflow::{Event, Job, Level, Permissions, Step, Workflow, WorkflowDispatch};

use crate::workflows::actions::{ActionsCheckout, ActionsUploadArtifact, OvenShSetupBun};
use crate::workflows::{runners, vars};

/// Where the export writes the definitions, and the artifact uploads them from.
const INVENTORY_DIR: &str = "/tmp/datadog-inventory";

/// Build the workflow.
pub fn export_datadog_observability() -> Workflow {
    Workflow::new("Export Datadog observability definitions")
        .on(Event::default().workflow_dispatch(WorkflowDispatch::default()))
        .permissions(Permissions::default().contents(Level::Read))
        .add_job("export", export())
}

fn export() -> Job {
    Job::default()
        .runs_on(runners::Runner::Small.to_string())
        .add_step(
            ActionsCheckout::new("")
                .persist_credentials(false)
                .step()
                .without_name(),
        )
        .add_step(OvenShSetupBun::new("").step().without_name())
        .add_step(
            Step::new("Read dashboards and monitors")
                .run(format!(
                    "bun infra/stacks/observability/migration/export-datadog.ts {INVENTORY_DIR}"
                ))
                .add_env(("DD_API_KEY", vars::DD_API_KEY))
                .add_env(("DD_APP_KEY", vars::DD_APP_KEY)),
        )
        .add_step(
            ActionsUploadArtifact::new("", INVENTORY_DIR)
                .name("datadog-observability-definitions")
                .retention_days(7)
                .step()
                .without_name()
                .if_condition(always()),
        )
}
