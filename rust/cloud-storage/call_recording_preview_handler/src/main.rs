#![recursion_limit = "256"]

use anyhow::Context;
use aws_lambda_events::event::s3::S3Event;
use call_recording_preview_handler::{HandlerConfig, HandlerState, handler};
use lambda_runtime::{Error, LambdaEvent, run, service_fn, tracing};
use macro_entrypoint::MacroEntrypoint;
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> Result<(), Error> {
    MacroEntrypoint::default().init();

    tracing::trace!("initiating call recording preview lambda");

    let config = HandlerConfig::from_env();
    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL must be provided")?;
    let db = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(1)
        .connect(&database_url)
        .await
        .context("could not connect to db")?;

    tracing::trace!("initialized db connection");

    let s3_client = macro_aws_config::s3_client().await;
    tracing::trace!("initialized s3 client");

    let state = HandlerState::new(s3_client, db, config);
    let func = service_fn(move |event: LambdaEvent<S3Event>| {
        let state = state.clone();
        async move { handler(state, event).await }
    });

    run(func).await
}
