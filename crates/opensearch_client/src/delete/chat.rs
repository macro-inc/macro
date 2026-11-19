use models_opensearch::SearchIndex;

use crate::{
    Result,
    error::{OpensearchClientError, OpensearchOperation},
    upsert::chat_message::{CHILD_RELATION, PARENT_RELATION},
};

/// Deletes the chat with the specified chat_id and every message under it.
/// Messages carry their own id in `entity_id`, so they are matched by their
/// parent.
#[tracing::instrument(skip(client))]
pub async fn delete_chat_by_id(
    client: &opensearch::OpenSearch,
    chat_id: &str,
    index_override: Option<&str>,
) -> Result<()> {
    let query = serde_json::json!({
        "query": {
            "bool": {
                "should": [
                    { "term": { "entity_id": chat_id } },
                    { "parent_id": { "type": CHILD_RELATION, "id": chat_id } }
                ]
            }
        },
    });

    let index = index_override.unwrap_or(SearchIndex::Chats.as_ref());
    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[index]))
        .body(query)
        .refresh(true) // Ensure the index reflects changes immediately
        .send()
        .await
        .map_err(|err| {
            OpensearchClientError::request_failed(OpensearchOperation::DeleteChatById, &err)
        })?;

    let status_code = response.status_code();

    if !status_code.is_success() {
        let body = response.text().await.map_err(|err| {
            OpensearchClientError::deserialization_failed(OpensearchOperation::DeleteChatById, &err)
        })?;

        tracing::error!(
            status_code = ?status_code,
            body = ?body,
            "error deleting chats by id"
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            operation: OpensearchOperation::DeleteChatById,
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
    index_override: Option<&str>,
) -> Result<()> {
    let query = serde_json::json!({
        "query": {
            "ids": { "values": [format!("{chat_id}:{chat_message_id}")] }
        }
    });

    let index = index_override.unwrap_or(SearchIndex::Chats.as_ref());
    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[index]))
        .body(query)
        .refresh(true) // Ensure the index reflects changes immediately
        .send()
        .await
        .map_err(|err| {
            OpensearchClientError::request_failed(OpensearchOperation::DeleteChatMessageById, &err)
        })?;

    let status_code = response.status_code();

    if !status_code.is_success() {
        let body = response.text().await.map_err(|err| {
            OpensearchClientError::deserialization_failed(
                OpensearchOperation::DeleteChatMessageById,
                &err,
            )
        })?;

        tracing::error!(
            status_code = ?status_code,
            body = ?body,
            "error deleting chats by id"
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            operation: OpensearchOperation::DeleteChatMessageById,
        });
    }

    Ok(())
}

/// Deletes every chat of a specific user_id and the messages under them.
#[tracing::instrument(skip(client))]
pub async fn delete_chat_by_user_id(client: &opensearch::OpenSearch, user_id: &str) -> Result<()> {
    delete_user_chats(client, user_id, SearchIndex::Chats.as_ref()).await
}

/// Deletes a user's chats in `index` and the messages under them. Messages
/// carry no `user_id`, so they are matched by their parent's.
pub(crate) async fn delete_user_chats(
    client: &opensearch::OpenSearch,
    user_id: &str,
    index: &str,
) -> Result<()> {
    let owned_by_user = serde_json::json!({ "term": { "user_id": user_id } });
    let query = serde_json::json!({
        "query": {
            "bool": {
                "should": [
                    owned_by_user,
                    { "has_parent": { "parent_type": PARENT_RELATION, "query": owned_by_user } }
                ]
            }
        },
    });

    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[index]))
        .body(query)
        .refresh(true) // Ensure the index reflects changes immediately
        .send()
        .await
        .map_err(|err| {
            OpensearchClientError::request_failed(OpensearchOperation::DeleteChatByUserId, &err)
        })?;

    let status_code = response.status_code();

    if !status_code.is_success() {
        let body = response.text().await.map_err(|err| {
            OpensearchClientError::deserialization_failed(
                OpensearchOperation::DeleteChatByUserId,
                &err,
            )
        })?;

        tracing::error!(
            status_code = ?status_code,
            body = ?body,
            "error deleting chats by user id"
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            operation: OpensearchOperation::DeleteChatByUserId,
        });
    }

    Ok(())
}

#[cfg(test)]
mod test;
