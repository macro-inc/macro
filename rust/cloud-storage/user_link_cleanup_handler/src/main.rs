use anyhow::Context;
use aws_lambda_events::event::eventbridge::EventBridgeEvent;
use lambda_runtime::{
    Error, LambdaEvent, run, service_fn,
    tracing::{self},
};
use macro_entrypoint::MacroEntrypoint;
use macro_env_var::env_vars;
use sqlx::postgres::PgPoolOptions;

env_vars! {
    struct DatabaseUrl;
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    MacroEntrypoint::default().init();

    tracing::trace!("initiating lambda");

    let database_url = DatabaseUrl::new().context("DATABASE_URL should be set")?;

    // We should only ever need 1 connection
    let db = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(1) // We want 1 db connection per dss item (document, project, chat)
        .connect(database_url.as_ref())
        .await
        .context("could not connect to db")?;

    let func = service_fn(move |event: LambdaEvent<EventBridgeEvent>| {
        let db = db.clone();

        async move { handler(db, event).await }
    });

    run(func).await
}

pub async fn handler(db: sqlx::PgPool, _event: LambdaEvent<EventBridgeEvent>) -> Result<(), Error> {
    macro_db_client::in_progress_user_link::delete_day_old_in_progress_user_links(&db).await?;

    macro_db_client::in_progress_email_link::delete_day_old_in_progress_email_links(&db).await?;

    Ok(())
}
