use std::sync::Arc;
use std::time::Duration;

use anyhow::Context as _;
use aws_sdk_sqs::types::Message;
use lambda_runtime::tracing;
use macro_env_var::maybe_env_vars;

use crate::AppContext;
use crate::inbound::s3_notification::object_created_events_from_body;

const LOCALSTACK_ACCOUNT_ID: &str = "000000000000";
const QUEUE_NAME: &str = "document-upload-finalizer-queue";

maybe_env_vars! {
    struct DocumentUploadFinalizerQueueUrl;
    struct LocalAwsUrl;
}

/// Run the LocalStack SQS polling adapter.
pub async fn run_local_sqs_worker(context: Arc<AppContext>) -> Result<(), anyhow::Error> {
    let queue_url = DocumentUploadFinalizerQueueUrl::new()
        .map(|queue_url| queue_url.to_string())
        .unwrap_or_else(default_queue_url);
    let sqs_client = aws_sdk_sqs::Client::new(&macro_aws_config::get_macro_aws_config().await);

    poll_forever(context, sqs_client, queue_url).await
}

fn default_queue_url() -> String {
    let local_aws_url = LocalAwsUrl::new()
        .map(|local_aws_url| local_aws_url.to_string())
        .unwrap_or_else(|| "http://localstack:4566".to_string());
    format!(
        "{}/{LOCALSTACK_ACCOUNT_ID}/{QUEUE_NAME}",
        local_aws_url.trim_end_matches('/')
    )
}

async fn poll_forever(
    context: Arc<AppContext>,
    sqs_client: aws_sdk_sqs::Client,
    queue_url: String,
) -> Result<(), anyhow::Error> {
    loop {
        let response = match sqs_client
            .receive_message()
            .queue_url(&queue_url)
            .wait_time_seconds(20)
            .max_number_of_messages(10)
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                tracing::warn!(error=?error, %queue_url, "failed to poll document upload finalizer queue");
                tokio::time::sleep(Duration::from_secs(5)).await;
                continue;
            }
        };

        for message in response.messages.unwrap_or_default() {
            let processed = handle_message(context.clone(), &message).await;

            match processed {
                Ok(()) => delete_message(&sqs_client, &queue_url, &message).await,
                Err(error) => {
                    tracing::error!(error=?error, "failed to process document upload finalizer message; leaving it on the queue");
                }
            }
        }
    }
}

async fn delete_message(sqs_client: &aws_sdk_sqs::Client, queue_url: &str, message: &Message) {
    let Some(receipt_handle) = &message.receipt_handle else {
        tracing::warn!(?message, "processed SQS message had no receipt handle");
        return;
    };

    if let Err(error) = sqs_client
        .delete_message()
        .queue_url(queue_url)
        .receipt_handle(receipt_handle)
        .send()
        .await
    {
        tracing::error!(error=?error, "failed to delete processed document upload finalizer message");
    }
}

async fn handle_message(context: Arc<AppContext>, message: &Message) -> Result<(), anyhow::Error> {
    let Some(body) = &message.body else {
        tracing::warn!(
            ?message,
            "document upload finalizer SQS message had no body"
        );
        return Ok(());
    };

    let events = match object_created_events_from_body(body) {
        Ok(events) => events,
        Err(error) => {
            tracing::warn!(error=?error, body, "discarding malformed document upload finalizer SQS message");
            return Ok(());
        }
    };

    for event in events {
        let key = event.key.clone();
        context
            .handle_object_created(event)
            .await
            .with_context(|| format!("failed to finalize upload for s3 key {key}"))?;
    }

    Ok(())
}
