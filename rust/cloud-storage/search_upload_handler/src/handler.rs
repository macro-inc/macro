use anyhow::Context;
use aws_lambda_events::event::eventbridge::EventBridgeEvent;
use lambda_runtime::{
    Error, LambdaEvent,
    tracing::{self},
};
use sqs_client::search::{SearchQueueMessage, document::SearchExtractorMessage};

#[derive(Debug)]
struct DocumentKeyParts {
    pub user_id: String,
    pub document_id: String,
    pub document_version_id: String,
    pub file_type: String,
}

impl TryFrom<String> for DocumentKeyParts {
    type Error = anyhow::Error;

    /// Tries to convert the document key into it's parts
    /// The document key is in the format of `user_id/document_id/document_version_id.file_type`
    fn try_from(value: String) -> Result<Self, Self::Error> {
        let parts: Vec<&str> = value.split('/').collect();

        if parts.len() != 3 {
            return Err(anyhow::anyhow!("expected 3 parts, got {}", parts.len()));
        }

        let file: Vec<&str> = parts[2].split('.').collect::<Vec<&str>>();

        if file.len() != 2 {
            return Err(anyhow::anyhow!("expected 2 file parts, got {}", file.len()));
        }

        Ok(Self {
            user_id: parts[0].to_string(),
            document_id: parts[1].to_string(),
            document_version_id: file[0].to_string(),
            file_type: file[1].to_string(),
        })
    }
}

/// Handles the Eventbridge event
#[tracing::instrument(skip(sqs_client))]
pub async fn handler(
    sqs_client: &sqs_client::SQS,
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

    let key = match urlencoding::decode(&key) {
        Ok(decoded) => decoded.to_string(),
        Err(e) => {
            tracing::warn!(error=?e, key=%key, "unable to decode key");
            return Ok(()); // Skip processing if key cannot be decoded
        }
    };

    // Ignore temp files as it leads to failures
    if key.starts_with("temp_files/") {
        tracing::trace!("skipping temp file");
        return Ok(());
    }

    let document_key_parts: DocumentKeyParts = match key.try_into() {
        Ok(parts) => parts,
        Err(e) => {
            tracing::warn!(error=?e, "unable to decode key");
            return Ok(()); // Skip processing if key cannot be decoded
        }
    };

    tracing::trace!(document_key_parts=?document_key_parts, "processing document key");

    let file_type = document_key_parts
        .file_type
        .as_str()
        .try_into()
        .context("unable to parse file type")?;

    let search_extractor_message = SearchExtractorMessage {
        user_id: document_key_parts.user_id,
        document_id: document_key_parts.document_id,
        document_version_id: Some(document_key_parts.document_version_id),
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
