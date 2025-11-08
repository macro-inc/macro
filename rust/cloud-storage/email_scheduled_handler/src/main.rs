mod config;
mod context;
mod handler;

use anyhow::Context;
use aws_lambda_events::event::eventbridge::EventBridgeEvent;
use config::Config;
use handler::handler;
use lambda_runtime::{Error, LambdaEvent, run, service_fn};
use macro_entrypoint::MacroEntrypoint;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<(), Error> {
    MacroEntrypoint::default().init();

    let config = Config::from_env().context("all necessary env vars should be available")?;

    // should only need a single connection to fetch the list of emails
    let db = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(1)
        .connect(&config.database_url)
        .await
        .context("could not connect to db")?;

    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(
        &aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region("us-east-1")
            .load()
            .await,
    ))
    .email_scheduled_queue(&config.email_scheduled_queue);

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
