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
pub struct DeletedByQuery {
    #[serde(default)]
    pub deleted: u64,
    #[serde(default)]
    pub version_conflicts: u64,
}

impl std::ops::AddAssign for DeletedByQuery {
    fn add_assign(&mut self, other: Self) {
        self.deleted += other.deleted;
        self.version_conflicts += other.version_conflicts;
    }
}

/// Message ids sent in one delete-by-query, far below OpenSearch's
/// `index.max_terms_count` (65,536), however large a reindex batch is.
pub const MESSAGE_IDS_PER_DELETE: usize = 1_000;

/// Deletes every document of a thread page's spam and trash messages, whatever
/// thread each was indexed under, in one delete-by-query that refreshes the
/// index when it removed something, so removals are visible to search when
/// this returns. A document another write changed after the page was read is
/// skipped and fails the call: the caller rereads the thread instead of acting
/// on a decision that may be stale; pass the result to [`fail_on_conflict`].
pub async fn delete_email_messages(
    client: &opensearch::OpenSearch,
    message_ids: &[String],
    index_override: Option<&str>,
) -> Result<DeletedByQuery> {
    if message_ids.is_empty() {
        return Ok(DeletedByQuery::default());
    }
    let index = resolve_destination(index_override);
    delete_by_message_ids(client, message_ids, index).await
}

/// Fails a delete that skipped documents on version conflicts.
pub fn fail_on_conflict(pass: DeletedByQuery) -> Result<DeletedByQuery> {
    if pass.version_conflicts > 0 {
        return Err(OpensearchClientError::Unknown {
            details: format!(
                "{} email documents changed while being deleted",
                pass.version_conflicts
            ),
            operation: OpensearchOperation::DeleteEmailMessages,
        });
    }
    Ok(pass)
}

/// Passes a single-message delete took and what it removed.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct EmailMessageDeleted {
    pub deleted: u64,
    pub passes: u8,
}

/// What deleting one message removed: its document under the thread its
/// event names, and copies indexed under other threads.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct EmailMessageRemoved {
    pub by_id: bool,
    pub other_threads: EmailMessageDeleted,
}

impl EmailMessageRemoved {
    pub fn deleted(&self) -> u64 {
        u64::from(self.by_id) + self.other_threads.deleted
    }
}

/// Deletes every document of one deleted message, whatever thread it was
/// indexed under, without forcing a refresh: search stops finding it at the
/// index's next scheduled refresh. The document under the event's thread is
/// deleted by id, which finds it even before a refresh has made it
/// searchable. A delete-by-query then removes copies under other threads; it
/// leaves that id out, because its search still sees the document just
/// deleted until the next refresh and would count it as a conflict. Deleting
/// cannot go stale, so a copy another write changed mid-query is deleted on
/// one more pass, after a refresh lets that pass see the change.
pub async fn delete_email_message(
    client: &opensearch::OpenSearch,
    message_id: &str,
    thread_id: &str,
    index_override: Option<&str>,
) -> Result<EmailMessageRemoved> {
    let index = resolve_destination(index_override);
    let document_id = crate::upsert::email::email_document_id(thread_id, message_id);
    let by_id = delete_document_by_id(client, &document_id, index).await?;
    let query = serde_json::json!({
        "query": {
            "bool": {
                "filter": [{ "term": { "message_id": message_id } }],
                "must_not": [{ "ids": { "values": [document_id] } }],
            }
        }
    });
    let other_threads = delete_with_recheck(
        || delete_by_query(client, index, &query, false),
        || refresh_index(client, index),
    )
    .await?;
    Ok(EmailMessageRemoved {
        by_id,
        other_threads,
    })
}

/// Deletes one email document by id; false when it was never indexed or is
/// already gone.
async fn delete_document_by_id(
    client: &opensearch::OpenSearch,
    document_id: &str,
    index: &str,
) -> Result<bool> {
    const OPERATION: OpensearchOperation = OpensearchOperation::DeleteEmailMessageById;
    let response = client
        .delete(opensearch::DeleteParts::IndexId(index, document_id))
        .send()
        .await
        .map_err(|err| OpensearchClientError::request_failed(OPERATION, &err))?;
    let status_code = response.status_code();
    if status_code.is_success() {
        return Ok(true);
    }
    let body = response
        .text()
        .await
        .map_err(|err| OpensearchClientError::deserialization_failed(OPERATION, &err))?;
    if is_missing_document(status_code.as_u16(), &body) {
        return Ok(false);
    }
    tracing::error!(status_code = ?status_code, body = ?body, "error deleting an email message by id");
    Err(OpensearchClientError::Unknown {
        details: body,
        operation: OPERATION,
    })
}

/// A delete-by-id 404 for a document that does not exist, not for a missing
/// index, which is an outage.
pub(crate) fn is_missing_document(status_code: u16, body: &str) -> bool {
    status_code == 404
        && serde_json::from_str::<serde_json::Value>(body)
            .is_ok_and(|value| value["result"] == "not_found")
}

/// Runs `pass`; when it skipped documents on version conflicts, runs
/// `refresh` and `pass` once more, and fails if they still conflict so the
/// caller's retry handles a document that keeps changing.
pub(crate) async fn delete_with_recheck<P, PF, R, RF>(
    mut pass: P,
    refresh: R,
) -> Result<EmailMessageDeleted>
where
    P: FnMut() -> PF,
    PF: Future<Output = Result<DeletedByQuery>>,
    R: FnOnce() -> RF,
    RF: Future<Output = Result<()>>,
{
    let first = pass().await?;
    if first.version_conflicts == 0 {
        return Ok(EmailMessageDeleted {
            deleted: first.deleted,
            passes: 1,
        });
    }
    refresh().await?;
    let second = fail_on_conflict(pass().await?)?;
    Ok(EmailMessageDeleted {
        deleted: first.deleted + second.deleted,
        passes: 2,
    })
}

async fn refresh_index(client: &opensearch::OpenSearch, index: &str) -> Result<()> {
    const OPERATION: OpensearchOperation = OpensearchOperation::RefreshEmailIndex;
    let response = client
        .indices()
        .refresh(opensearch::indices::IndicesRefreshParts::Index(&[index]))
        .send()
        .await
        .map_err(|err| OpensearchClientError::request_failed(OPERATION, &err))?;
    if response.status_code().is_success() {
        return Ok(());
    }
    let status_code = response.status_code();
    let body = response
        .text()
        .await
        .map_err(|err| OpensearchClientError::deserialization_failed(OPERATION, &err))?;
    tracing::error!(status_code = ?status_code, body = ?body, "error refreshing the email index");
    Err(OpensearchClientError::Unknown {
        details: body,
        operation: OPERATION,
    })
}

async fn delete_by_message_ids(
    client: &opensearch::OpenSearch,
    message_ids: &[String],
    index: &str,
) -> Result<DeletedByQuery> {
    let query = serde_json::json!({ "query": { "terms": { "message_id": message_ids } } });
    delete_by_query(client, index, &query, true).await // Ensure the index reflects changes immediately
}

async fn delete_by_query(
    client: &opensearch::OpenSearch,
    index: &str,
    query: &serde_json::Value,
    refresh: bool,
) -> Result<DeletedByQuery> {
    const OPERATION: OpensearchOperation = OpensearchOperation::DeleteEmailMessages;
    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[index]))
        .body(query)
        .conflicts(opensearch::params::Conflicts::Proceed)
        .refresh(refresh)
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
        serde_json::from_str(body).map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
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
    serde_json::from_value(value).map_err(|err| OpensearchClientError::DeserializationFailed {
        details: err.to_string(),
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
