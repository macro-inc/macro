use anyhow::Context;
use aws_lambda_events::event::eventbridge::EventBridgeEvent;
use document_storage_service_client::DocumentStorageServiceClient;
use lambda_runtime::{
    Error, LambdaEvent,
    tracing::{self},
};
use s3_key::DocumentKey;

/// Handles the Eventbridge event
#[tracing::instrument(skip(dss_client), err)]
pub async fn handler(
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
            tracing::warn!(error=?e, key=%key, "unable to parse key");
            return Ok(());
        }
    };

    if document_key.is_temp() || document_key.is_bom_part() {
        tracing::trace!("skipping non-document key");
        return Ok(());
    }

    let document_id = document_key.document_id().expect("document key has id");

    tracing::trace!(?document_key, "processing document key");

    let document_basic = dss_client
        .get_document_basic(document_id)
        .await
        .context("Failed to fetch document basic info")?
        .ok_or_else(|| anyhow::anyhow!("document not found"))?;

    let file_type = match document_basic.try_file_type() {
        Some(file_type) => file_type,
        None => {
            tracing::trace!(document_id=?document_id, "no file type found");
            return Ok(());
        }
    };

    let document_version_id = document_key.version_id_string();
    dss_client
        .publish_document_content_uploaded(document_id, file_type, document_version_id)
        .await?;

    tracing::info!(document_id, "relayed document content upload");

    Ok(())
}
