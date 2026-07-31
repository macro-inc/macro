use anyhow::Context;
use aws_lambda_events::eventbridge::EventBridgeEvent;
use document_storage_service_client::DocumentStorageServiceClient;
use handler::handler;
use lambda_runtime::{Error, LambdaEvent, run, service_fn, tracing};
use macro_entrypoint::MacroEntrypoint;
use macro_env_var::env_vars;
use macro_service_urls::DocumentStorageServiceUrl;

mod handler;

env_vars! {
    struct DocumentStorageServiceAuthKey;
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    MacroEntrypoint::default().init();

    tracing::trace!("initiating lambda");

    let dss_url = DocumentStorageServiceUrl::new()?.to_string();
    let dss_auth_key = DocumentStorageServiceAuthKey::new()
        .context("DOCUMENT_STORAGE_SERVICE_AUTH_KEY must be provided")?
        .to_string();

    let dss_client = DocumentStorageServiceClient::new(dss_auth_key, dss_url);

    let func = service_fn(move |event: LambdaEvent<EventBridgeEvent>| {
        let dss_client = dss_client.clone();
        async move { handler(&dss_client, event).await }
    });

    run(func).await
}
