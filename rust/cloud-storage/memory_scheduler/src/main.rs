mod handler;

use anyhow::Context;
use aws_lambda_events::event::eventbridge::EventBridgeEvent;
use handler::handler;
use lambda_runtime::{Error, LambdaEvent, run, service_fn, tracing};
use macro_entrypoint::MacroEntrypoint;
use memory::outbound::pg_memory_repo::PgMemoryRepo;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<(), Error> {
    MacroEntrypoint::default().init();
    tracing::trace!("initiating memory_scheduler lambda");

    let database_url =
        std::env::var("DATABASE_URL").context("DATABASE_URL must be provided")?;
    let memory_queue_url = std::env::var("MEMORY_GENERATION_QUEUE_URL")
        .context("MEMORY_GENERATION_QUEUE_URL must be provided")?;

    let db = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(1)
        .connect(&database_url)
        .await
        .context("could not connect to db")?;

    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(
        &macro_aws_config::get_macro_aws_config().await,
    ))
    .memory_generation_queue(&memory_queue_url);

    let repo = PgMemoryRepo::new(db);
    let shared_repo = Arc::new(repo);
    let shared_sqs = Arc::new(sqs_client);

    let func = service_fn(move |event: LambdaEvent<EventBridgeEvent>| {
        let repo = shared_repo.clone();
        let sqs = shared_sqs.clone();
        async move { handler(repo, sqs, event).await }
    });

    run(func).await
}
