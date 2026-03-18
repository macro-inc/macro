use anyhow::Context;
use aws_lambda_events::event::eventbridge::EventBridgeEvent;
use document_storage_service_client::DocumentStorageServiceClient;
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
}

impl TryFrom<String> for DocumentKeyParts {
    type Error = anyhow::Error;

    /// Tries to convert the document key into it's parts
    /// Supports both extensionless keys (`user_id/document_id/version_id`)
    /// and legacy keys with extension (`user_id/document_id/version_id.file_type`)
    fn try_from(value: String) -> Result<Self, Self::Error> {
        let parts: Vec<&str> = value.split('/').collect();

        if parts.len() != 3 {
            anyhow::bail!("expected 3 parts, got {}", parts.len());
        }

        let version_part = parts[2];
        let document_version_id = version_part
            .split('.')
            .next()
            .unwrap_or(version_part)
            .to_string();

        Ok(Self {
            user_id: parts[0].to_string(),
            document_id: parts[1].to_string(),
            document_version_id,
        })
    }
}

/// Handles the Eventbridge event
#[tracing::instrument(skip(sqs_client, dss_client))]
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

    // Resolve file type: from the key extension (legacy) or via DSS lookup (extensionless)
    let document_basic = dss_client
        .get_document_basic(&document_key_parts.document_id)
        .await
        .context("Failed to fetch document basic info")?
        .ok_or_else(|| anyhow::anyhow!("document not found"))?;

    let file_type = document_basic
        .try_file_type()
        .ok_or_else(|| anyhow::anyhow!("file type not found"))?;

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
