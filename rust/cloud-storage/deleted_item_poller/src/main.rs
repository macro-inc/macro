mod config;
mod context;
mod handler;

use anyhow::Context;
use aws_lambda_events::event::eventbridge::EventBridgeEvent;
use config::Config;
use handler::handler;
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
        .min_connections(3)
        .max_connections(3) // We want 1 db connection per dss item (document, project, chat)
        .connect(&config.database_url)
        .await
        .context("could not connect to db")?;

    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(
        &aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region("us-east-1")
            .load()
            .await,
    ))
    .document_delete_queue(&config.document_delete_queue)
    .chat_delete_queue(&config.chat_delete_queue)
    .search_event_queue(&config.search_event_queue);

    let ctx = context::Context {
        db,
        sqs_client: Arc::new(sqs_client),
    };

    let func = service_fn(move |event: LambdaEvent<EventBridgeEvent>| {
        let ctx = ctx.clone();

        async move { handler(ctx, event).await }
    });

    run(func).await
}
