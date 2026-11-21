//! `Check Macro Database Migrations`: fails a deploy whose commit carries a
//! migration the environment's database has not applied.

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

pub fn check_macro_db_migrations() -> CompositeAction {
    CompositeAction::new(
        "Check Macro Database Migrations",
        "Fail unless every migration in the checked-out commit is applied to the \
         environment's database. Applies nothing.",
    )
    .add_input(
        "environment",
        ActionInput::required("Environment whose database is checked (dev, prod)"),
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
            .run(include_str!(
                "check_macro_db_migrations/get_database_url.sh"
            ))
            .id(DATABASE_URL.id())
            .shell("bash")
            .add_env(("ENVIRONMENT", input::<Str>("environment"))),
    )
    .add_step(
        Step::new("Check that every migration is applied")
            .run("\"$GITHUB_ACTION_PATH/check-migrations-applied.sh\"\n")
            .shell("bash")
            .working_directory("crates/macro_db_client")
            .add_env(("DATABASE_URL", DATABASE_URL.outputs.database_url.read()))
            .add_env(("ENVIRONMENT", input::<Str>("environment"))),
    )
}
