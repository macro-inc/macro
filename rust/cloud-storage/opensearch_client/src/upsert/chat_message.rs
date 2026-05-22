use models_opensearch::SearchIndex;

use crate::{
    Result,
    chats_shape::{alias_uses_join_shape, destination_uses_join_shape},
    date_format::EpochSeconds,
    error::OpensearchClientError,
};

/// Relation name for parent docs in the chats join field.
const PARENT_RELATION: &str = "chat";

/// Relation name for child (message) docs in the chats join field.
const CHILD_RELATION: &str = "message";

/// The arguments for upserting a chat message into the opensearch index
#[derive(Debug, serde::Serialize)]
pub struct UpsertChatMessageArgs {
    /// The id of the chat
    #[serde(rename = "entity_id")]
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

/// Resolve `index_override` to the physical/alias name we'll write to.
fn resolve_destination(index_override: Option<&str>) -> &str {
    index_override.unwrap_or(SearchIndex::Chats.as_ref())
}

#[tracing::instrument(skip(client))]
pub(crate) async fn upsert_chat_message(
    client: &opensearch::OpenSearch,
    args: &UpsertChatMessageArgs,
    index_override: Option<&str>,
) -> Result<()> {
    let destination = resolve_destination(index_override);
    if destination_uses_join_shape(destination) {
        upsert_chat_message_join(client, args, destination).await
    } else {
        upsert_chat_message_flat(client, args, destination).await
    }
}

// ---------------------------------------------------------------------------
// Flat-shape (legacy) path
// ---------------------------------------------------------------------------

async fn upsert_chat_message_flat(
    client: &opensearch::OpenSearch,
    args: &UpsertChatMessageArgs,
    index: &str,
) -> Result<()> {
    let id = format!("{}:{}", args.chat_id, args.chat_message_id);
    let response = client
        .index(opensearch::IndexParts::IndexId(index, &id))
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
        return Ok(());
    }

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

    Err(OpensearchClientError::Unknown {
        details: body,
        method: Some("upsert_chat_message".to_string()),
    })
}

// ---------------------------------------------------------------------------
// Join-shape path
// ---------------------------------------------------------------------------

/// Builds the JSON document body for the parent chat doc.
fn parent_doc_body(args: &UpsertChatMessageArgs) -> serde_json::Value {
    serde_json::json!({
        "entity_id": &args.chat_id,
        "title": &args.title,
        "user_id": &args.user_id,
        "updated_at_seconds": args.updated_at_seconds,
        "chat_relation": PARENT_RELATION,
    })
}

/// Builds the JSON document body for a child (message) doc.
fn child_doc_body(args: &UpsertChatMessageArgs) -> serde_json::Value {
    serde_json::json!({
        "entity_id": &args.chat_message_id,
        "chat_message_id": &args.chat_message_id,
        "content": &args.content,
        "role": &args.role,
        "created_at_seconds": args.created_at_seconds,
        "updated_at_seconds": args.updated_at_seconds,
        "chat_relation": {
            "name": CHILD_RELATION,
            "parent": &args.chat_id,
        },
    })
}

/// Writes the parent chat doc and the child message doc, each rooted at
/// the chat_id via `_routing` so they live on the same shard. Uses
/// full-overwrite `index` semantics (not `update + doc_as_upsert`) so
/// stale optional fields can't leak across writes.
async fn upsert_chat_message_join(
    client: &opensearch::OpenSearch,
    args: &UpsertChatMessageArgs,
    index: &str,
) -> Result<()> {
    let routing = args.chat_id.as_str();

    let parent_body = parent_doc_body(args);
    let parent_response = client
        .index(opensearch::IndexParts::IndexId(index, &args.chat_id))
        .routing(routing)
        .body(parent_body)
        .send()
        .await
        .map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            method: Some("upsert_chat_message_join_parent".to_string()),
        })?;

    if !parent_response.status_code().is_success() {
        let status_code = parent_response.status_code();
        let body = parent_response.text().await.map_err(|err| {
            OpensearchClientError::DeserializationFailed {
                details: err.to_string(),
                method: Some("upsert_chat_message_join_parent".to_string()),
            }
        })?;
        tracing::error!(
            status_code=%status_code,
            body=%body,
            "error upserting chat parent doc",
        );
        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some("upsert_chat_message_join_parent".to_string()),
        });
    }

    let child_id = format!("{}:{}", args.chat_id, args.chat_message_id);
    let child_body = child_doc_body(args);
    let child_response = client
        .index(opensearch::IndexParts::IndexId(index, &child_id))
        .routing(routing)
        .body(child_body)
        .send()
        .await
        .map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            method: Some("upsert_chat_message_join_child".to_string()),
        })?;

    let status_code = child_response.status_code();
    if status_code.is_success() {
        tracing::trace!(id=%child_id, "chat message upserted successfully (join)");
        return Ok(());
    }

    let body = child_response.text().await.map_err(|err| {
        OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            method: Some("upsert_chat_message_join_child".to_string()),
        }
    })?;

    tracing::error!(
        status_code=%status_code,
        body=%body,
        "error upserting chat message (join)",
    );

    Err(OpensearchClientError::Unknown {
        details: body,
        method: Some("upsert_chat_message_join_child".to_string()),
    })
}

// ---------------------------------------------------------------------------
// Chat metadata updates
// ---------------------------------------------------------------------------

/// Updates the chat metadata for all chat messages.
///
/// On the join shape, title lives only on the parent doc so this is a
/// single update by id. On the flat shape, title is denormalized across
/// every message doc so we update by query.
#[tracing::instrument(skip(client))]
pub(crate) async fn update_chat_metadata(
    client: &opensearch::OpenSearch,
    chat_id: &str,
    title: &str,
) -> Result<()> {
    if alias_uses_join_shape() {
        update_chat_metadata_join(client, chat_id, title).await
    } else {
        update_chat_metadata_flat(client, chat_id, title).await
    }
}

async fn update_chat_metadata_join(
    client: &opensearch::OpenSearch,
    chat_id: &str,
    title: &str,
) -> Result<()> {
    use opensearch::UpdateParts;
    use serde_json::json;

    let body = json!({ "doc": { "title": title } });

    let response = client
        .update(UpdateParts::IndexId(SearchIndex::Chats.as_ref(), chat_id))
        .routing(chat_id)
        .body(body)
        .send()
        .await
        .map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            method: Some("update_chat_metadata_join".to_string()),
        })?;

    let status_code = response.status_code();
    if status_code.is_success() {
        tracing::debug!(
            chat_id=%chat_id,
            title=%title,
            "chat metadata updated successfully (join)"
        );
        return Ok(());
    }

    let body =
        response
            .text()
            .await
            .map_err(|err| OpensearchClientError::DeserializationFailed {
                details: err.to_string(),
                method: Some("update_chat_metadata_join".to_string()),
            })?;

    tracing::error!(
        status_code=?status_code,
        body=?body,
        chat_id=%chat_id,
        "error updating chat metadata (join)",
    );

    Err(OpensearchClientError::Unknown {
        details: body,
        method: Some("update_chat_metadata_join".to_string()),
    })
}

async fn update_chat_metadata_flat(
    client: &opensearch::OpenSearch,
    chat_id: &str,
    title: &str,
) -> Result<()> {
    use opensearch::UpdateByQueryParts;
    use serde_json::json;

    let query = json!({
        "query": {
            "term": {
                "entity_id": chat_id
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
        .update_by_query(UpdateByQueryParts::Index(&[SearchIndex::Chats.as_ref()]))
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
