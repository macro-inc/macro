use anyhow::Context;
use aws_lambda_events::eventbridge::EventBridgeEvent;
use handler::handler;
use lambda_runtime::{Error, LambdaEvent, run, service_fn, tracing};
use macro_entrypoint::MacroEntrypoint;
use std::sync::Arc;

mod handler;

#[tokio::main]
async fn main() -> Result<(), Error> {
    MacroEntrypoint::default().init();

    tracing::trace!("initiating lambda");

    let search_event_queue =
        std::env::var("SEARCH_EVENT_QUEUE").context("SEARCH_EVENT_QUEUE must be provided")?;

    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(
        &aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region("us-east-1")
            .load()
            .await,
    ))
    .search_event_queue(&search_event_queue);

    let shared_sqs_client = Arc::new(sqs_client);

    let func = service_fn(move |event: LambdaEvent<EventBridgeEvent>| {
        let sqs_client = shared_sqs_client.clone();

        async move { handler(&sqs_client, event).await }
    });

    run(func).await
}
