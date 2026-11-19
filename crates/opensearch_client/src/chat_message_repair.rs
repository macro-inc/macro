//! Direct reads and deletes of the message documents in the chats index, for
//! the repair that removes messages whose source row is gone.

use crate::{
    Result,
    error::{OpensearchClientError, OpensearchOperation, write_refusal},
    upsert::{REPORTED_ITEM_ERRORS, chat_message::CHILD_RELATION},
};

#[cfg(test)]
mod test;

/// A message document in the chats index. It lives under its chat, routed by
/// the chat id, with the id `{chat_id}:{message_id}`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexedChatMessage {
    pub chat_id: String,
    pub message_id: String,
}

impl IndexedChatMessage {
    fn document_id(&self) -> String {
        format!("{}:{}", self.chat_id, self.message_id)
    }
}

/// Outcome of deleting a batch of message documents.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct ChatMessageDeleteResult {
    pub deleted: usize,
    /// Documents already absent, such as ones a live delete removed first.
    pub not_found: usize,
}

/// Up to `size` message documents of `index` whose message id sorts after
/// `after_message_id` (or from the first), in message id order. Message ids
/// are unique, so paging on them visits each document once.
pub(crate) async fn chat_messages_after(
    client: &opensearch::OpenSearch,
    index: &str,
    after_message_id: Option<&str>,
    size: u16,
) -> Result<Vec<IndexedChatMessage>> {
    const OPERATION: OpensearchOperation = OpensearchOperation::ReadIndexedChatMessages;
    let mut body = serde_json::json!({
        "size": size,
        "_source": false,
        "track_total_hits": false,
        "query": { "term": { "chat_relation": CHILD_RELATION } },
        "sort": [{ "entity_id": "asc" }],
    });
    if let Some(after) = after_message_id {
        body["search_after"] = serde_json::json!([after]);
    }

    let response = client
        .search(opensearch::SearchParts::Index(&[index]))
        .body(body)
        .send()
        .await
        .map_err(|error| OpensearchClientError::request_failed(OPERATION, &error))?;
    let status = response.status_code();
    let body = response
        .text()
        .await
        .map_err(|error| OpensearchClientError::deserialization_failed(OPERATION, &error))?;
    if !status.is_success() {
        return Err(OpensearchClientError::Unknown {
            details: body,
            operation: OPERATION,
        });
    }

    parse_chat_message_page(&body)
}

fn parse_chat_message_page(body: &str) -> Result<Vec<IndexedChatMessage>> {
    const OPERATION: OpensearchOperation = OpensearchOperation::ReadIndexedChatMessages;
    let malformed = |details: String| OpensearchClientError::DeserializationFailed {
        details,
        operation: OPERATION,
    };
    let response: serde_json::Value =
        serde_json::from_str(body).map_err(|error| malformed(error.to_string()))?;
    // A page that read only some shards, or timed out with partial hits,
    // would skip documents for good, since the next page starts after its
    // last id.
    let failed_shards = response["_shards"]["failed"].as_u64().unwrap_or_default();
    if failed_shards > 0 || response["timed_out"].as_bool() == Some(true) {
        return Err(OpensearchClientError::Unknown {
            details: format!(
                "{failed_shards} shards failed, timed out: {}: {}",
                response["timed_out"], response["_shards"]
            ),
            operation: OPERATION,
        });
    }
    let hits = response["hits"]["hits"]
        .as_array()
        .ok_or_else(|| malformed("search response has no hits array".to_owned()))?;

    hits.iter()
        .map(|hit| {
            let message_id = hit["sort"][0]
                .as_str()
                .ok_or_else(|| malformed(format!("hit has no message id to sort on: {hit}")))?;
            let chat_id = hit["_routing"]
                .as_str()
                .ok_or_else(|| malformed(format!("hit has no routing: {hit}")))?;
            let message = IndexedChatMessage {
                chat_id: chat_id.to_owned(),
                message_id: message_id.to_owned(),
            };
            if hit["_id"].as_str() != Some(message.document_id().as_str()) {
                return Err(malformed(format!(
                    "hit's id does not name its chat and message: {hit}"
                )));
            }
            Ok(message)
        })
        .collect()
}

/// Delete `messages` from `index` in one `_bulk` request, each routed to its
/// chat's shard. A refused request fails with
/// [`OpensearchClientError::WritesRefused`]; any failed item, other than a
/// document already gone, fails the call with
/// [`OpensearchClientError::BulkItemsFailed`], whose `refusal()` is set when
/// OpenSearch refused an item to protect itself.
pub(crate) async fn delete_chat_messages(
    client: &opensearch::OpenSearch,
    index: &str,
    messages: &[IndexedChatMessage],
) -> Result<ChatMessageDeleteResult> {
    const OPERATION: OpensearchOperation = OpensearchOperation::BulkDeleteChatMessages;
    if messages.is_empty() {
        return Ok(ChatMessageDeleteResult::default());
    }

    let body: Vec<String> = messages
        .iter()
        .map(|message| {
            serde_json::json!({
                "delete": { "_id": message.document_id(), "routing": message.chat_id }
            })
            .to_string()
        })
        .collect();
    let response = client
        .bulk(opensearch::BulkParts::Index(index))
        .body(body)
        .send()
        .await
        .map_err(|error| OpensearchClientError::request_failed(OPERATION, &error))?;
    let status = response.status_code().as_u16();
    let body = response
        .text()
        .await
        .map_err(|error| OpensearchClientError::deserialization_failed(OPERATION, &error))?;

    classify_delete_response(status, &body)
}

fn classify_delete_response(status: u16, body: &str) -> Result<ChatMessageDeleteResult> {
    const OPERATION: OpensearchOperation = OpensearchOperation::BulkDeleteChatMessages;
    let parsed = serde_json::from_str::<serde_json::Value>(body);

    if !(200..300).contains(&status) {
        let error = parsed
            .map(|value| value["error"].clone())
            .unwrap_or_default();
        if let Some(cause) = write_refusal(status, &error) {
            return Err(OpensearchClientError::WritesRefused {
                details: body.to_owned(),
                cause,
                operation: OPERATION,
            });
        }
        return Err(OpensearchClientError::Unknown {
            details: body.to_owned(),
            operation: OPERATION,
        });
    }

    let response = parsed.map_err(|error| OpensearchClientError::DeserializationFailed {
        details: error.to_string(),
        operation: OPERATION,
    })?;
    let items = response["items"].as_array().ok_or_else(|| {
        OpensearchClientError::DeserializationFailed {
            details: "bulk response has no items array".to_owned(),
            operation: OPERATION,
        }
    })?;
    let mut result = ChatMessageDeleteResult::default();
    let mut failed = 0;
    let mut refusal = None;
    let mut errors: Vec<String> = Vec::new();
    for item in items {
        let delete = &item["delete"];
        let item_status = delete["status"]
            .as_u64()
            .and_then(|status| u16::try_from(status).ok())
            .unwrap_or_default();
        if (200..300).contains(&item_status) {
            result.deleted += 1;
            continue;
        }
        if item_status == 404 && delete["result"].as_str() == Some("not_found") {
            result.not_found += 1;
            continue;
        }

        failed += 1;
        let error = &delete["error"];
        refusal = refusal.or(write_refusal(item_status, error));
        let described = format!(
            "{}: {}",
            error["type"].as_str().unwrap_or("unknown"),
            error["reason"].as_str().unwrap_or_default()
        );
        if errors.len() < REPORTED_ITEM_ERRORS && !errors.contains(&described) {
            errors.push(described);
        }
    }

    if failed > 0 {
        return Err(OpensearchClientError::BulkItemsFailed {
            failed,
            total: items.len(),
            refusal,
            errors,
            operation: OPERATION,
        });
    }
    Ok(result)
}
