#![recursion_limit = "256"]
mod config;
mod context;
mod event;
mod refresh;

use anyhow::Context;
use config::Config;
use event::RefreshEvent;
use lambda_runtime::{
    Error, LambdaEvent, run, service_fn,
    tracing::{self},
};
use macro_entrypoint::MacroEntrypoint;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<(), Error> {
    MacroEntrypoint::default().init();
    tracing::trace!("initiating lambda");

    let config = Config::from_env().context("all necessary env vars should be available")?;

    tracing::trace!("initialized config");

    // We should only ever need 1 connection
    let db = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(1)
        .connect(&config.database_url)
        .await
        .context("could not connect to db")?;

    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(
        &macro_aws_config::get_macro_aws_config().await,
    ))
    .ai_projection_queue(&config.ai_projection_queue);

    let ctx = context::Context {
        db,
        sqs_client: Arc::new(sqs_client),
    };

    let func = service_fn(move |event: LambdaEvent<RefreshEvent>| {
        let ctx = ctx.clone();

        async move { handler(ctx, event).await }
    });

    run(func).await
}

/// Runs a refresh sweep for the cadence carried by the scheduled EventBridge
/// event: delete inactive instances, and enqueue a refresh for stale ones.
#[tracing::instrument(skip(ctx, event), err)]
async fn handler(ctx: context::Context, event: LambdaEvent<RefreshEvent>) -> Result<(), Error> {
    let cadence = event.payload.refresh_cadence;
    tracing::info!(
        cadence = cadence.as_str(),
        "running ai projection refresh sweep"
    );

    let stats = refresh::run(&ctx, cadence).await?;

    tracing::info!(
        cadence = cadence.as_str(),
        deleted = stats.deleted,
        refreshed = stats.refreshed,
        enqueue_failures = stats.enqueue_failures,
        "ai projection refresh sweep complete"
    );

    Ok(())
}
