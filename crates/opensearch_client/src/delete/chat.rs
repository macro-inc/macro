use models_opensearch::SearchIndex;

use crate::{
    Result,
    error::OpensearchOperation,
    upsert::chat_message::{CHILD_RELATION, PARENT_RELATION},
};

/// Deletes the chat with the specified chat_id and every message under it.
/// Messages carry their own id in `entity_id`, so they are matched by their
/// parent; `parent_id` still finds them if a retry runs after the chat itself
/// is gone.
#[tracing::instrument(skip(client))]
pub async fn delete_chat_by_id(
    client: &opensearch::OpenSearch,
    chat_id: &str,
    index_override: Option<&str>,
) -> Result<()> {
    super::by_query::delete_matching(
        client,
        index_override.unwrap_or(SearchIndex::Chats.as_ref()),
        serde_json::json!({ "bool": { "should": [
            { "term": { "entity_id": chat_id } },
            { "parent_id": { "type": CHILD_RELATION, "id": chat_id } }
        ] } }),
        OpensearchOperation::DeleteChatById,
    )
    .await
}

/// Deletes a particular chat message with the specified chat_id and chat_message_id
#[tracing::instrument(skip(client))]
pub async fn delete_chat_message_by_id(
    client: &opensearch::OpenSearch,
    chat_id: &str,
    chat_message_id: &str,
    index_override: Option<&str>,
) -> Result<()> {
    super::by_query::delete_matching(
        client,
        index_override.unwrap_or(SearchIndex::Chats.as_ref()),
        serde_json::json!({ "ids": { "values": [format!("{chat_id}:{chat_message_id}")] } }),
        OpensearchOperation::DeleteChatMessageById,
    )
    .await
}

/// Deletes every chat of a specific user_id and the messages under them.
#[tracing::instrument(skip(client))]
pub async fn delete_chat_by_user_id(client: &opensearch::OpenSearch, user_id: &str) -> Result<()> {
    delete_user_chats(client, user_id, SearchIndex::Chats.as_ref()).await
}

/// Deletes a user's chats in `index` and the messages under them. Messages
/// carry no `user_id`, so they are matched by their chat's, and go first:
/// once a chat is gone nothing finds its messages.
pub(crate) async fn delete_user_chats(
    client: &opensearch::OpenSearch,
    user_id: &str,
    index: &str,
) -> Result<()> {
    let owned_by_user = serde_json::json!({ "term": { "user_id": user_id } });
    super::by_query::delete_matching(
        client,
        index,
        serde_json::json!({ "has_parent": { "parent_type": PARENT_RELATION, "query": owned_by_user } }),
        OpensearchOperation::DeleteChatByUserId,
    )
    .await?;
    super::by_query::delete_matching(
        client,
        index,
        owned_by_user,
        OpensearchOperation::DeleteChatByUserId,
    )
    .await
}

#[cfg(test)]
mod test;
