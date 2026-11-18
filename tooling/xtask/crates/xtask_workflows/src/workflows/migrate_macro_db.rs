//! `Migrate Macro Database` — manually applies MacroDB's migrations to the dev
//! or prod database from the in-VPC migrator runner, through the
//! `migrate-cloud-storage-db` composite action.

use gh_workflow::expr::typed::{Str, input};
use gh_workflow::{Event, Job, Workflow, WorkflowDispatch, WorkflowInput, ZizmorRule};

use crate::workflows::actions::{ActionsCheckout, LocalMigrateCloudStorageDb};
use crate::workflows::runners;

/// Build the workflow.
pub fn migrate_macro_db() -> Workflow {
    Workflow::new("Migrate Macro Database")
        .on(Event::default().workflow_dispatch(
            WorkflowDispatch::default().add_input(
                "environment",
                WorkflowInput::choice(["dev", "prod"])
                    .description("Environment to run migrations for")
                    .required(true),
            ),
        ))
        .add_job("migrate-db", migrate())
}

fn migrate() -> Job {
    Job::default()
        .name(format!(
            "Run Database Migrations ({})",
            input::<Str>("environment")
        ))
        .runs_on(runners::DB_MIGRATOR)
        // Only the composite action itself; it checks out the migrations.
        .add_step(
            ActionsCheckout::new("")
                .sparse_checkout(".github/\n")
                .step()
                .without_name()
                .zizmor_ignore(
                    ZizmorRule::Artipacked,
                    "the migration action that runs next may use the persisted token",
                ),
        )
        .add_step(
            LocalMigrateCloudStorageDb::new("Run migrations", input::<Str>("environment")).step(),
        )
}
