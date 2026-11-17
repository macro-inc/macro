//! `Migrate Cloud Storage Database`: applies MacroDB's migrations to an
//! environment's database.

use gh_workflow::expr::typed::{StepHandle, StepOutput, Str, input};
use gh_workflow::{ActionInput, CompositeAction, Step, ZizmorRule};

use crate::workflows::actions::ActionsCheckout;

struct DatabaseUrlOutputs {
    database_url: StepOutput<Str>,
}

const DATABASE_URL: StepHandle<DatabaseUrlOutputs> = StepHandle::new(
    "get-db-url",
    DatabaseUrlOutputs {
        database_url: StepOutput::new("get-db-url", "database_url"),
    },
);

pub fn migrate_cloud_storage_db() -> CompositeAction {
    CompositeAction::new(
        "Migrate Cloud Storage Database",
        "Run database migrations for cloud storage services",
    )
    .add_input(
        "environment",
        ActionInput::required("Environment to run migrations for (dev, prod)"),
    )
    .add_step(
        ActionsCheckout::new("")
            .sparse_checkout(".github/\ncrates/macro_db_client\n")
            .step()
            .without_name()
            .zizmor_ignore(
                ZizmorRule::Artipacked,
                "the calling deploy job may use the persisted token",
            ),
    )
    .add_step(
        Step::new("Get database URL from Secrets Manager")
            .run(include_str!("migrate_cloud_storage_db/get_database_url.sh"))
            .id(DATABASE_URL.id())
            .shell("bash")
            .add_env(("MIGRATION_ENVIRONMENT", input::<Str>("environment"))),
    )
    .add_step(
        Step::new("Run database migrations")
            .run(include_str!("migrate_cloud_storage_db/run_migrations.sh"))
            .shell("bash")
            .working_directory("crates/macro_db_client")
            .add_env(("DATABASE_URL", DATABASE_URL.outputs.database_url.read()))
            .add_env(("MIGRATION_ENVIRONMENT", input::<Str>("environment"))),
    )
}
