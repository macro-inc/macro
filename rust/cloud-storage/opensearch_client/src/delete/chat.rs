use crate::{CHAT_INDEX, Result, error::OpensearchClientError};

/// Deletes all chat messages with the specified chat_id
#[tracing::instrument(skip(client))]
pub async fn delete_chat_by_id(client: &opensearch::OpenSearch, chat_id: &str) -> Result<()> {
    let query = serde_json::json!({
        "query": {
            "term": {
                "chat_id": chat_id
            }
        },
    });

    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[CHAT_INDEX]))
        .body(query)
        .refresh(true) // Ensure the index reflects changes immediately
        .send()
        .await
        .map_err(|err| OpensearchClientError::Unknown {
            details: err.to_string(),
            method: Some("delete_chat_by_id".to_string()),
        })?;

    let status_code = response.status_code();

    if !status_code.is_success() {
        let body =
            response
                .text()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some("delete_chat_by_id".to_string()),
                })?;

        tracing::error!(
            status_code = ?status_code,
            body = ?body,
            "error deleting chats by id"
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some("delete_chat_by_id".to_string()),
        });
    }

    Ok(())
}

/// Deletes a particular chat message with the specified chat_id and chat_message_id
#[tracing::instrument(skip(client))]
pub async fn delete_chat_message_by_id(
    client: &opensearch::OpenSearch,
    chat_id: &str,
    chat_message_id: &str,
) -> Result<()> {
    let query = serde_json::json!({
        "query": {
            "bool": {
                "must": [
                    {
                        "term": {
                            "chat_id": chat_id
                        }
                    },
                    {
                        "term": {
                            "chat_message_id": chat_message_id
                        }
                    }
                ]
            }
        }
    });

    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[CHAT_INDEX]))
        .body(query)
        .refresh(true) // Ensure the index reflects changes immediately
        .send()
        .await
        .map_err(|err| OpensearchClientError::Unknown {
            details: err.to_string(),
            method: Some("delete_chat_message_by_id".to_string()),
        })?;

    let status_code = response.status_code();

    if !status_code.is_success() {
        let body =
            response
                .text()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some("delete_chat_message_by_id".to_string()),
                })?;

        tracing::error!(
            status_code = ?status_code,
            body = ?body,
            "error deleting chats by id"
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some("delete_chat_message_by_id".to_string()),
        });
    }

    Ok(())
}

/// Deletes all chat messages with a specific user_id
#[tracing::instrument(skip(client))]
pub async fn delete_chat_by_user_id(client: &opensearch::OpenSearch, user_id: &str) -> Result<()> {
    let query = serde_json::json!({
        "query": {
            "term": {
                "user_id": user_id
            }
        },
    });

    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[CHAT_INDEX]))
        .body(query)
        .refresh(true) // Ensure the index reflects changes immediately
        .send()
        .await
        .map_err(|err| OpensearchClientError::Unknown {
            details: err.to_string(),
            method: Some("delete_chat_by_user_id".to_string()),
        })?;

    let status_code = response.status_code();

    if !status_code.is_success() {
        let body =
            response
                .text()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some("delete_chat_by_user_id".to_string()),
                })?;

        tracing::error!(
            status_code = ?status_code,
            body = ?body,
            "error deleting chats by user id"
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some("delete_chat_by_user_id".to_string()),
        });
    }

    Ok(())
}
