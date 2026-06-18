use std::sync::Arc;

mod handler;
mod service;

use anyhow::Context;
use aws_lambda_events::sqs::SqsEvent;
use handler::handler;
use lambda_runtime::{Error, LambdaEvent, run, service_fn, tracing};
use macro_entrypoint::MacroEntrypoint;
use macro_env_var::env_vars;
use sqlx::postgres::PgPoolOptions;

env_vars! {
    struct DatabaseUrl;
    struct DocumentDeleteQueue;
    struct ChatDeleteQueue;
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

    let document_delete_queue =
        DocumentDeleteQueue::new().context("DOCUMENT_DELETE_QUEUE must be provided")?;
    let chat_delete_queue = ChatDeleteQueue::new().context("CHAT_DELETE_QUEUE must be provided")?;

    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(
        &macro_aws_config::get_macro_aws_config().await,
    ))
    .document_delete_queue(document_delete_queue.as_ref())
    .chat_delete_queue(chat_delete_queue.as_ref());

    let shared_db = Arc::new(db);
    let shared_sqs_client = Arc::new(sqs_client);

    let func = service_fn(move |event: LambdaEvent<SqsEvent>| {
        let db = shared_db.clone();
        let sqs_client = shared_sqs_client.clone();

        async move { handler(db, sqs_client, event).await }
    });

    run(func).await
}
