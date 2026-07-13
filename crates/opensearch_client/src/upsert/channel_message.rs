use models_opensearch::SearchIndex;

use crate::{Result, date_format::EpochSeconds, error::OpensearchClientError};

/// The arguments for upserting a channel message into the opensearch index.
/// Threadless messages are indexed with `thread_id == message_id`.
#[derive(Debug, serde::Serialize)]
pub struct UpsertChannelMessageArgs {
    #[serde(rename = "entity_id")]
    pub channel_id: String,
    pub channel_type: String,
    pub org_id: Option<i64>,
    pub message_id: String,
    pub thread_id: String,
    pub sender_id: String,
    pub mentions: Vec<String>,
    pub content: String,
    pub created_at_seconds: EpochSeconds,
    pub updated_at_seconds: EpochSeconds,
}

#[tracing::instrument(skip(client))]
pub(crate) async fn upsert_channel_message(
    client: &opensearch::OpenSearch,
    args: &UpsertChannelMessageArgs,
    index_override: Option<&str>,
) -> Result<()> {
    let id = format!("{}:{}", args.channel_id, args.message_id);
    let index = index_override.unwrap_or(SearchIndex::Channels.as_ref());

    let response = client
        .index(opensearch::IndexParts::IndexId(index, &id))
        .body(args)
        .send()
        .await
        .map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            method: Some("upsert_channel_message".to_string()),
        })?;

    let status_code = response.status_code();
    if status_code.is_success() {
        tracing::trace!(id=%id, "channel message upserted successfully");
    } else {
        let body =
            response
                .text()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some("upsert_channel_message".to_string()),
                })?;

        tracing::error!(
            status_code=%status_code,
            body=%body,
            "error upserting channel message",
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some("upsert_channel_message".to_string()),
        });
    }
    Ok(())
}
