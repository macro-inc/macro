use crate::{CHAT_INDEX, Result, date_format::EpochSeconds, error::OpensearchClientError};

/// The arguments for upserting a chat message into the opensearch index
#[derive(Debug, serde::Serialize)]
pub struct UpsertChatMessageArgs {
    /// The id of the chat
    pub chat_id: String,
    /// The id of the chat message
    pub chat_message_id: String,
    /// The user id of the chat message
    pub user_id: String,
    /// The role of the chat message
    pub role: String,
    /// The created at time of the chat message
    pub created_at_seconds: EpochSeconds,
    /// The updated at time of the chat message
    pub updated_at_seconds: EpochSeconds,
    /// The title of the chat message
    pub title: String,
    /// The content of the chat message
    pub content: String,
}

#[tracing::instrument(skip(client))]
pub(crate) async fn upsert_chat_message(
    client: &opensearch::OpenSearch,
    args: &UpsertChatMessageArgs,
) -> Result<()> {
    let id = format!("{}:{}", args.chat_id, args.chat_message_id);
    let response = client
        .index(opensearch::IndexParts::IndexId(CHAT_INDEX, &id))
        .body(args)
        .send()
        .await
        .map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            method: Some("upsert_chat_message".to_string()),
        })?;

    let status_code = response.status_code();
    if status_code.is_success() {
        tracing::trace!(id=%id, "chat message upserted successfully");
    } else {
        let body =
            response
                .text()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some("upsert_chat_message".to_string()),
                })?;

        tracing::error!(
            status_code=%status_code,
            body=%body,
            "error upserting chat message",
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some("upsert_chat_message".to_string()),
        });
    }
    Ok(())
}

/// Updates the chat metadata for all chat messages
#[tracing::instrument(skip(client))]
pub(crate) async fn update_chat_metadata(
    client: &opensearch::OpenSearch,
    chat_id: &str,
    title: &str,
) -> Result<()> {
    use opensearch::UpdateByQueryParts;
    use serde_json::json;

    let query = json!({
        "query": {
            "term": {
                "chat_id": chat_id
            }
        },
        "script": {
            "source": "ctx._source.title = params.title",
            "params": {
                "title": title
            }
        }
    });

    let response = client
        .update_by_query(UpdateByQueryParts::Index(&[CHAT_INDEX]))
        .body(query)
        .send()
        .await
        .map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            method: Some("update_chat_metadata".to_string()),
        })?;

    let status_code = response.status_code();
    if status_code.is_success() {
        let response_body: serde_json::Value =
            response
                .json()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some("update_chat_metadata".to_string()),
                })?;

        let updated_count = response_body["updated"].as_u64().unwrap_or(0);
        tracing::debug!(
            chat_id=%chat_id,
            title=%title,
            updated_count=%updated_count,
            "chat metadata updated successfully"
        );
    } else {
        let body =
            response
                .text()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some("update_chat_metadata".to_string()),
                })?;

        tracing::error!(
            status_code=?status_code,
            body=?body,
            chat_id=%chat_id,
            "error updating chat metadata",
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some("update_chat_metadata".to_string()),
        });
    }

    Ok(())
}
