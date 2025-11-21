use models_opensearch::SearchIndex;

use crate::{Result, error::OpensearchClientError};

/// Deletes all channel messages with the specified channel_id
#[tracing::instrument(skip(client))]
pub async fn delete_channel_by_id(client: &opensearch::OpenSearch, channel_id: &str) -> Result<()> {
    let query = serde_json::json!({
        "query": {
            "term": {
                "channel_id": channel_id
            }
        },
    });

    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[
            SearchIndex::Channels.as_ref(),
        ]))
        .body(query)
        .refresh(true) // Ensure the index reflects changes immediately
        .send()
        .await
        .map_err(|err| OpensearchClientError::Unknown {
            details: err.to_string(),
            method: Some("delete_channel_by_id".to_string()),
        })?;

    let status_code = response.status_code();

    if !status_code.is_success() {
        let body =
            response
                .text()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some("delete_channel_by_id".to_string()),
                })?;

        tracing::error!(
            status_code = ?status_code,
            body = ?body,
            "error deleting channels by id"
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some("delete_channel_by_id".to_string()),
        });
    }

    Ok(())
}

/// Deletes a particular channel message with the specified channel_id and channel_message_id
#[tracing::instrument(skip(client))]
pub async fn delete_channel_message_by_id(
    client: &opensearch::OpenSearch,
    channel_id: &str,
    channel_message_id: &str,
) -> Result<()> {
    let query = serde_json::json!({
        "query": {
            "bool": {
                "must": [
                    {
                        "term": {
                            "channel_id": channel_id
                        }
                    },
                    {
                        "term": {
                            "message_id": channel_message_id
                        }
                    }
                ]
            }
        }
    });

    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[
            SearchIndex::Channels.as_ref(),
        ]))
        .body(query)
        .refresh(true) // Ensure the index reflects changes immediately
        .send()
        .await
        .map_err(|err| OpensearchClientError::Unknown {
            details: err.to_string(),
            method: Some("delete_channel_message_by_id".to_string()),
        })?;

    let status_code = response.status_code();

    if !status_code.is_success() {
        let body =
            response
                .text()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some("delete_channel_message_by_id".to_string()),
                })?;

        tracing::error!(
            status_code = ?status_code,
            body = ?body,
            "error deleting channels by id"
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some("delete_channel_message_by_id".to_string()),
        });
    }

    Ok(())
}
