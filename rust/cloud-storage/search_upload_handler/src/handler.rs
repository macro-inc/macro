use anyhow::Context;
use aws_lambda_events::event::eventbridge::EventBridgeEvent;
use document_storage_service_client::DocumentStorageServiceClient;
use lambda_runtime::{
    Error, LambdaEvent,
    tracing::{self},
};
use s3_key::DocumentKey;
use sqs_client::search::{SearchQueueMessage, document::SearchExtractorMessage};

/// Handles the Eventbridge event
#[tracing::instrument(skip(sqs_client, dss_client), err)]
pub async fn handler(
    sqs_client: &sqs_client::SQS,
    dss_client: &DocumentStorageServiceClient,
    event: LambdaEvent<EventBridgeEvent>,
) -> Result<(), Error> {
    tracing::trace!("processing event");

    let event_detail = &event.payload.detail;

    let key = event_detail
        .get("object")
        .and_then(|object| object.get("key"))
        .and_then(|key| key.as_str())
        .unwrap_or("")
        .to_string();

    let document_key = match DocumentKey::from_s3_key(&key) {
        Ok(key) => key,
        Err(e) => {
            tracing::warn!(error=?e, "unable to parse key");
            return Ok(());
        }
    };

    if document_key.is_temp() {
        tracing::trace!("skipping temp file");
        return Ok(());
    }

    let document_id = document_key.document_id();

    tracing::trace!(?document_key, "processing document key");

    let document_basic = dss_client
        .get_document_basic(document_id)
        .await
        .context("Failed to fetch document basic info")?
        .ok_or_else(|| anyhow::anyhow!("document not found"))?;

    let file_type = document_basic
        .try_file_type()
        .ok_or_else(|| anyhow::anyhow!("file type not found"))?;

    let search_extractor_message = SearchExtractorMessage {
        user_id: document_basic.owner.to_string(),
        document_id: document_id.to_string(),
        document_version_id: document_key.version_id_string(),
        file_type,
    };

    // All other file types are to be sent to the search text extractor queue
    let message_id = sqs_client
        .send_message_to_search_event_queue(SearchQueueMessage::ExtractDocumentText(
            search_extractor_message,
        ))
        .await?;

    tracing::info!(message_id=?message_id, "sent message to search extractor queue");

    Ok(())
}
