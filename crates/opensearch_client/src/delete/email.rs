use models_opensearch::SearchIndex;

use crate::{
    Result,
    error::{OpensearchClientError, OpensearchOperation},
};

#[cfg(test)]
mod test;

fn resolve_destination(index_override: Option<&str>) -> &str {
    index_override.unwrap_or(SearchIndex::Emails.as_ref())
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
        .map_err(|err| {
            OpensearchClientError::request_failed(OpensearchOperation::DeleteEmailByLinkId, &err)
        })?;

    let status_code = response.status_code();

    if !status_code.is_success() {
        let body = response.text().await.map_err(|err| {
            OpensearchClientError::deserialization_failed(
                OpensearchOperation::DeleteEmailByLinkId,
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
            operation: OpensearchOperation::DeleteEmailByLinkId,
        });
    }

    Ok(())
}

/// Documents a delete-by-query over email message ids removed, and those it
/// skipped because another write changed them between its search and delete.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
pub(crate) struct DeletedByQuery {
    #[serde(default)]
    pub(crate) deleted: u64,
    #[serde(default)]
    pub(crate) version_conflicts: u64,
}

/// Deletes every document of the given email messages, whatever thread each
/// was indexed under, in one delete-by-query that refreshes the index when it
/// removed something, so the removals are visible to search when this
/// returns. Documents another write changed mid-query are deleted on one
/// second pass, instead of failing the whole request on the conflict.
/// Returns how many documents were removed.
pub async fn delete_email_messages(
    client: &opensearch::OpenSearch,
    message_ids: &[String],
    index_override: Option<&str>,
) -> Result<u64> {
    if message_ids.is_empty() {
        return Ok(0);
    }
    let index = resolve_destination(index_override);
    delete_with_recheck(|| delete_by_message_ids(client, message_ids, index)).await
}

/// Runs `pass` once more when it skipped documents on version conflicts, and
/// fails when they still conflict, so the caller's retry handles a document
/// that keeps changing.
pub(crate) async fn delete_with_recheck<F, Fut>(mut pass: F) -> Result<u64>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<DeletedByQuery>>,
{
    let first = pass().await?;
    if first.version_conflicts == 0 {
        return Ok(first.deleted);
    }
    let second = pass().await?;
    if second.version_conflicts > 0 {
        return Err(OpensearchClientError::Unknown {
            details: format!(
                "{} email documents kept changing while being deleted",
                second.version_conflicts
            ),
            operation: OpensearchOperation::DeleteEmailMessages,
        });
    }
    Ok(first.deleted + second.deleted)
}

async fn delete_by_message_ids(
    client: &opensearch::OpenSearch,
    message_ids: &[String],
    index: &str,
) -> Result<DeletedByQuery> {
    const OPERATION: OpensearchOperation = OpensearchOperation::DeleteEmailMessages;
    let query = serde_json::json!({ "query": { "terms": { "message_id": message_ids } } });
    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[index]))
        .body(query)
        .conflicts(opensearch::params::Conflicts::Proceed)
        .refresh(true) // Ensure the index reflects changes immediately
        .send()
        .await
        .map_err(|err| OpensearchClientError::request_failed(OPERATION, &err))?;

    let status_code = response.status_code();
    let body = response
        .text()
        .await
        .map_err(|err| OpensearchClientError::deserialization_failed(OPERATION, &err))?;
    if !status_code.is_success() {
        tracing::error!(status_code = ?status_code, body = ?body, "error deleting email messages");
        return Err(OpensearchClientError::Unknown {
            details: body,
            operation: OPERATION,
        });
    }
    parse_deleted_by_query(&body)
}

/// Reads a delete-by-query response; per-document failures other than the
/// version conflicts `conflicts=proceed` counts fail the call.
pub(crate) fn parse_deleted_by_query(body: &str) -> Result<DeletedByQuery> {
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|err| OpensearchClientError::Unknown {
            details: format!("unreadable delete-by-query response: {err}"),
            operation: OpensearchOperation::DeleteEmailMessages,
        })?;
    if value["failures"]
        .as_array()
        .is_some_and(|failures| !failures.is_empty())
    {
        return Err(OpensearchClientError::Unknown {
            details: value["failures"].to_string(),
            operation: OpensearchOperation::DeleteEmailMessages,
        });
    }
    serde_json::from_value(value).map_err(|err| OpensearchClientError::Unknown {
        details: format!("unreadable delete-by-query counts: {err}"),
        operation: OpensearchOperation::DeleteEmailMessages,
    })
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
        .map_err(|err| {
            OpensearchClientError::request_failed(OpensearchOperation::DeleteEmailByUserId, &err)
        })?;

    let status_code = response.status_code();

    if !status_code.is_success() {
        let body = response.text().await.map_err(|err| {
            OpensearchClientError::deserialization_failed(
                OpensearchOperation::DeleteEmailByUserId,
                &err,
            )
        })?;

        tracing::error!(
            status_code = ?status_code,
            body = ?body,
            "error deleting emails by user id"
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            operation: OpensearchOperation::DeleteEmailByUserId,
        });
    }

    Ok(())
}
