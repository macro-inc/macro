mod handler;
mod service;
use std::sync::Arc;

use anyhow::Context;
use aws_lambda_events::sqs::SqsEvent;
use handler::handler;
use lambda_runtime::{Error, LambdaEvent, run, service_fn, tracing};
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

    let database_url = DatabaseUrl::new().context("DATABASE_URL must be provided")?;
    let db = service::db::DB::new(
        PgPoolOptions::new()
            .min_connections(1)
            .max_connections(1) // we only ever need one connection per lambda
            .connect(database_url.as_ref())
            .await
            .context("could not connect to db")?,
    );

    tracing::trace!("initialized db client");

    let shared_db = Arc::new(db);

    let func = service_fn(move |event: LambdaEvent<SqsEvent>| {
        let db = shared_db.clone();
        async move { handler(db, event).await }
    });

    run(func).await
}
