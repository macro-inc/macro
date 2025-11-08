use std::sync::Arc;

mod service;

use anyhow::Context;
use aws_lambda_events::event::eventbridge::EventBridgeEvent;
use lambda_runtime::{
    Error, LambdaEvent, run, service_fn,
    tracing::{self},
};
use macro_entrypoint::MacroEntrypoint;
use sqlx::postgres::PgPoolOptions;

#[tracing::instrument(skip(db, sqs_client, event))]
async fn handler(
    db: Arc<service::db::DB>,
    sqs_client: Arc<sqs_client::SQS>,
    event: LambdaEvent<EventBridgeEvent<serde_json::Value>>,
) -> Result<(), Error> {
    tracing::trace!("processing event {:?}", event.payload.id);

    let organizations = db.get_organization_retention().await?;

    sqs_client
        .bulk_enqueue_organization_retention(organizations)
        .await?;

    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    MacroEntrypoint::default().init();

    tracing::info!("initiating lambda");

    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL must be set")?;
    let db = service::db::DB::new(
        PgPoolOptions::new()
            .min_connections(1)
            .max_connections(1) // we only ever need one connection per lambda
            .connect(&database_url)
            .await
            .context("could not connect to db")?,
    );

    tracing::trace!("initialized db client");

    let organization_retention_queue = std::env::var("ORGANIZATION_RETENTION_QUEUE")
        .context("ORGANIZATION_RETENTION_QUEUE must be set")?;
    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(
        &aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region("us-east-1")
            .load()
            .await,
    ))
    .organization_retention_queue(&organization_retention_queue);

    tracing::trace!("initialized ecs client");

    // Shared references
    let shared_sqs_client = Arc::new(sqs_client);
    let shared_db = Arc::new(db);

    let func = service_fn(
        move |event: LambdaEvent<EventBridgeEvent<serde_json::Value>>| {
            let sqs_client = shared_sqs_client.clone();
            let db = shared_db.clone();
            async move { handler(db, sqs_client, event).await }
        },
    );

    run(func).await
}
