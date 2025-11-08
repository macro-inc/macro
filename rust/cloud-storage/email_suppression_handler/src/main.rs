mod handler;
mod model;

use handler::handler;

use anyhow::Context;
use aws_lambda_events::sns::SnsEvent;
use lambda_runtime::{Error, LambdaEvent, run, service_fn, tracing};
use macro_entrypoint::MacroEntrypoint;
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> Result<(), Error> {
    MacroEntrypoint::default().init();

    tracing::trace!("initiating lambda");

    tracing::trace!("initialized config");
    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL must be provided")?;

    let db = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(1) // we only ever need one connection per lambda
        .connect(&database_url)
        .await
        .context("could not connect to db")?;

    tracing::trace!("initialized db client");

    let func = service_fn(move |event: LambdaEvent<SnsEvent>| {
        let db = db.clone();
        async move { handler(db, event).await }
    });

    run(func).await
}
