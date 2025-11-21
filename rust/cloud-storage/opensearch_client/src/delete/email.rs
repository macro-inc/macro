use models_opensearch::SearchIndex;

use crate::{Result, error::OpensearchClientError};

/// Deletes all email messages with the specified thread_id
#[tracing::instrument(skip(client))]
pub async fn delete_email_by_thread_id(
    client: &opensearch::OpenSearch,
    thread_id: &str,
) -> Result<()> {
    let query = serde_json::json!({
        "query": {
            "term": {
                "thread_id": thread_id
            }
        },
    });

    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[
            SearchIndex::Emails.as_ref(),
        ]))
        .body(query)
        .refresh(true) // Ensure the index reflects changes immediately
        .send()
        .await
        .map_err(|err| OpensearchClientError::Unknown {
            details: err.to_string(),
            method: Some("delete_email_by_thread_id".to_string()),
        })?;

    let status_code = response.status_code();

    if !status_code.is_success() {
        let body =
            response
                .text()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some("delete_email_by_thread_id".to_string()),
                })?;

        tracing::error!(
            status_code = ?status_code,
            body = ?body,
            "error deleting chats by id"
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some("delete_email_by_thread_id".to_string()),
        });
    }

    Ok(())
}

/// Deletes all email messages with the specified link_id
#[tracing::instrument(skip(client))]
pub async fn delete_email_by_link_id(client: &opensearch::OpenSearch, link_id: &str) -> Result<()> {
    let query = serde_json::json!({
        "query": {
            "term": {
                "link_id": link_id
            }
        },
    });

    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[
            SearchIndex::Emails.as_ref(),
        ]))
        .body(query)
        .refresh(true) // Ensure the index reflects changes immediately
        .send()
        .await
        .map_err(|err| OpensearchClientError::Unknown {
            details: err.to_string(),
            method: Some("delete_email_by_link_id".to_string()),
        })?;

    let status_code = response.status_code();

    if !status_code.is_success() {
        let body =
            response
                .text()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some("delete_email_by_link_id".to_string()),
                })?;

        tracing::error!(
            status_code = ?status_code,
            body = ?body,
            "error deleting chats by id"
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some("delete_email_by_link_id".to_string()),
        });
    }

    Ok(())
}

/// Deletes a particular email message
#[tracing::instrument(skip(client))]
pub async fn delete_email_message_by_id(
    client: &opensearch::OpenSearch,
    message_id: &str,
) -> Result<()> {
    let query = serde_json::json!({
        "query": {
            "term": {
                "message_id": message_id
            }
        },
    });

    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[
            SearchIndex::Emails.as_ref(),
        ]))
        .body(query)
        .refresh(true) // Ensure the index reflects changes immediately
        .send()
        .await
        .map_err(|err| OpensearchClientError::Unknown {
            details: err.to_string(),
            method: Some("delete_email_message_by_id".to_string()),
        })?;

    let status_code = response.status_code();

    if !status_code.is_success() {
        let body =
            response
                .text()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some("delete_email_message_by_id".to_string()),
                })?;

        tracing::error!(
            status_code = ?status_code,
            body = ?body,
            "error deleting email message by id"
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some("delete_email_message_by_id".to_string()),
        });
    }

    Ok(())
}

/// Deletes all email messages with a specific user_id
#[tracing::instrument(skip(client))]
pub async fn delete_email_by_user_id(client: &opensearch::OpenSearch, user_id: &str) -> Result<()> {
    let query = serde_json::json!({
        "query": {
            "term": {
                "user_id": user_id
            }
        },
    });

    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[
            SearchIndex::Emails.as_ref(),
        ]))
        .body(query)
        .refresh(true) // Ensure the index reflects changes immediately
        .send()
        .await
        .map_err(|err| OpensearchClientError::Unknown {
            details: err.to_string(),
            method: Some("delete_email_by_user_id".to_string()),
        })?;

    let status_code = response.status_code();

    if !status_code.is_success() {
        let body =
            response
                .text()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some("delete_email_by_user_id".to_string()),
                })?;

        tracing::error!(
            status_code = ?status_code,
            body = ?body,
            "error deleting emails by user id"
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some("delete_email_by_user_id".to_string()),
        });
    }

    Ok(())
}
