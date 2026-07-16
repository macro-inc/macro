use models_opensearch::SearchIndex;

use crate::upsert::properties::IndexedProperty;
use crate::{Result, date_format::EpochMillis, error::OpensearchClientError};

#[cfg(test)]
mod test;

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
    /// The created at time of the chat message, in milliseconds
    pub created_at_millis: EpochMillis,
    /// The updated at time of the chat message, in milliseconds
    pub updated_at_millis: EpochMillis,
    /// The title of the chat message
    pub title: String,
    /// The content of the chat message
    pub content: String,
    /// Denormalized parent entity properties (tags, custom) used for search
    /// filtering. Empty for chats without properties.
    pub properties: Vec<IndexedProperty>,
}

/// Resolve `index_override` to the physical/alias name we'll write to.
fn resolve_destination(index_override: Option<&str>) -> &str {
    index_override.unwrap_or(SearchIndex::Chats.as_ref())
}

/// Builds the JSON document body for the parent chat doc. Properties ride
/// every parent write because the write is a full overwrite — omitting them
/// would wipe values set by `update_chat_properties`.
fn parent_doc_body(args: &UpsertChatMessageArgs) -> serde_json::Value {
    let mut doc = serde_json::json!({
        "entity_id": &args.chat_id,
        "title": &args.title,
        "user_id": &args.user_id,
        "updated_at_millis": args.updated_at_millis,
        "chat_relation": PARENT_RELATION,
    });
    if !args.properties.is_empty()
        && let Ok(properties) = serde_json::to_value(&args.properties)
    {
        doc["properties"] = properties;
    }
    doc
}

/// Builds the JSON document body for a child (message) doc.
fn child_doc_body(args: &UpsertChatMessageArgs) -> serde_json::Value {
    serde_json::json!({
        "entity_id": &args.chat_message_id,
        "chat_message_id": &args.chat_message_id,
        "content": &args.content,
        "role": &args.role,
        "created_at_millis": args.created_at_millis,
        "updated_at_millis": args.updated_at_millis,
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
#[tracing::instrument(skip(client))]
pub(crate) async fn upsert_chat_message(
    client: &opensearch::OpenSearch,
    args: &UpsertChatMessageArgs,
    index_override: Option<&str>,
) -> Result<()> {
    let index = resolve_destination(index_override);
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
            method: Some("upsert_chat_message_parent".to_string()),
        })?;

    if !parent_response.status_code().is_success() {
        let status_code = parent_response.status_code();
        let body = parent_response.text().await.map_err(|err| {
            OpensearchClientError::DeserializationFailed {
                details: err.to_string(),
                method: Some("upsert_chat_message_parent".to_string()),
            }
        })?;
        tracing::error!(
            status_code=%status_code,
            body=%body,
            "error upserting chat parent doc",
        );
        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some("upsert_chat_message_parent".to_string()),
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
            method: Some("upsert_chat_message_child".to_string()),
        })?;

    let status_code = child_response.status_code();
    if status_code.is_success() {
        tracing::trace!(id=%child_id, "chat message upserted successfully");
        return Ok(());
    }

    let body = child_response.text().await.map_err(|err| {
        OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            method: Some("upsert_chat_message_child".to_string()),
        }
    })?;

    tracing::error!(
        status_code=%status_code,
        body=%body,
        "error upserting chat message",
    );

    Err(OpensearchClientError::Unknown {
        details: body,
        method: Some("upsert_chat_message_child".to_string()),
    })
}

// ---------------------------------------------------------------------------
// Chat metadata updates
// ---------------------------------------------------------------------------

/// Updates the chat metadata for a chat. Title lives only on the parent
/// doc so this is a single update by id, routed to the parent's shard.
#[tracing::instrument(skip(client))]
pub(crate) async fn update_chat_metadata(
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
            method: Some("update_chat_metadata".to_string()),
        })?;

    let status_code = response.status_code();
    if status_code.is_success() {
        tracing::debug!(
            chat_id=%chat_id,
            title=%title,
            "chat metadata updated successfully"
        );
        return Ok(());
    }

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

    Err(OpensearchClientError::Unknown {
        details: body,
        method: Some("update_chat_metadata".to_string()),
    })
}

/// Update only the denormalized `properties` on an existing parent chat doc,
/// without touching messages. Used when a chat's properties change
/// independently of its content. A missing doc (404) is treated as a no-op —
/// the next message upsert will include the properties.
pub(crate) async fn update_chat_properties(
    client: &opensearch::OpenSearch,
    chat_id: &str,
    properties: &[IndexedProperty],
) -> Result<()> {
    use serde_json::json;

    let properties_value =
        serde_json::to_value(properties).map_err(|err| OpensearchClientError::Unknown {
            details: err.to_string(),
            method: Some("update_chat_properties".to_string()),
        })?;
    let body = json!({ "doc": { "properties": properties_value } });

    let response = client
        .update(opensearch::UpdateParts::IndexId(
            SearchIndex::Chats.as_ref(),
            chat_id,
        ))
        .routing(chat_id)
        .body(body)
        .send()
        .await
        .map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            method: Some("update_chat_properties".to_string()),
        })?;

    let status_code = response.status_code();
    if status_code.is_success() {
        tracing::trace!(chat_id=%chat_id, "chat properties updated");
        return Ok(());
    }
    let body =
        response
            .text()
            .await
            .map_err(|err| OpensearchClientError::DeserializationFailed {
                details: err.to_string(),
                method: Some("update_chat_properties".to_string()),
            })?;

    // A *missing document* 404 is a no-op: the chat isn't indexed yet, so the
    // next message upsert will include its properties. A *missing index* 404
    // (`index_not_found_exception`) is a real outage and must propagate.
    if status_code.as_u16() == 404 {
        let error_type = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| value["error"]["type"].as_str().map(str::to_owned));
        if error_type.as_deref() == Some("document_missing_exception") {
            tracing::debug!(
                chat_id=%chat_id,
                "chat not indexed yet; skipping property update"
            );
            return Ok(());
        }
    }

    tracing::error!(
        status_code=?status_code,
        body=?body,
        chat_id=%chat_id,
        "error updating chat properties",
    );

    Err(OpensearchClientError::Unknown {
        details: body,
        method: Some("update_chat_properties".to_string()),
    })
}
