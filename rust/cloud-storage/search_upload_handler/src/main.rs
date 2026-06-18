use anyhow::Context;
use aws_lambda_events::eventbridge::EventBridgeEvent;
use document_storage_service_client::DocumentStorageServiceClient;
use handler::handler;
use lambda_runtime::{Error, LambdaEvent, run, service_fn, tracing};
use macro_entrypoint::MacroEntrypoint;
use macro_env_var::env_vars;
use macro_service_urls::DocumentStorageServiceUrl;
use std::sync::Arc;

mod handler;

env_vars! {
    struct SearchEventQueue;
    struct DocumentStorageServiceAuthKey;
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    MacroEntrypoint::default().init();

    tracing::trace!("initiating lambda");

    let search_event_queue =
        SearchEventQueue::new().context("SEARCH_EVENT_QUEUE must be provided")?;

    let dss_url = DocumentStorageServiceUrl::new()?.to_string();
    let dss_auth_key = DocumentStorageServiceAuthKey::new()
        .context("DOCUMENT_STORAGE_SERVICE_AUTH_KEY must be provided")?
        .to_string();

    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(
        &macro_aws_config::get_macro_aws_config().await,
    ))
    .search_event_queue(search_event_queue.as_ref());

    let shared_sqs_client = Arc::new(sqs_client);
    let shared_dss_client = Arc::new(DocumentStorageServiceClient::new(dss_auth_key, dss_url));

    let func = service_fn(move |event: LambdaEvent<EventBridgeEvent>| {
        let sqs_client = shared_sqs_client.clone();
        let dss_client = shared_dss_client.clone();

        async move { handler(&sqs_client, &dss_client, event).await }
    });

    run(func).await
}
