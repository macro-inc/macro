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

/// Starts deleting every email document of an inbox as a background
/// OpenSearch task and returns its id without waiting. The task is throttled
/// to `docs_per_second` across automatic slices so it cannot crowd out search,
/// skips documents changed mid-delete instead of aborting, and forces no
/// refresh: the scheduled refresh makes the removals visible.
pub async fn start_email_link_delete(
    client: &opensearch::OpenSearch,
    link_id: &str,
    docs_per_second: i64,
) -> Result<String> {
    const OPERATION: OpensearchOperation = OpensearchOperation::StartEmailLinkDelete;
    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[
            SearchIndex::Emails.as_ref(),
        ]))
        .body(serde_json::json!({ "query": { "term": { "link_id": link_id } } }))
        .wait_for_completion(false)
        .conflicts(opensearch::params::Conflicts::Proceed)
        .slices(opensearch::params::Slices::Auto)
        .requests_per_second(docs_per_second)
        .send()
        .await
        .map_err(|err| OpensearchClientError::request_failed(OPERATION, &err))?;

    let status_code = response.status_code();
    let body = response
        .text()
        .await
        .map_err(|err| OpensearchClientError::deserialization_failed(OPERATION, &err))?;
    if !status_code.is_success() {
        tracing::error!(status_code = ?status_code, body = ?body, "error starting an inbox delete");
        return Err(OpensearchClientError::Unknown {
            details: body,
            operation: OPERATION,
        });
    }
    let started: serde_json::Value = serde_json::from_str(&body).map_err(|err| {
        OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            operation: OPERATION,
        }
    })?;
    started["task"].as_str().map(str::to_owned).ok_or_else(|| {
        OpensearchClientError::DeserializationFailed {
            details: format!("no task id in {body}"),
            operation: OPERATION,
        }
    })
}

/// Progress of a background email delete task.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct EmailDeleteTask {
    /// Whether the task has finished, successfully or not.
    pub completed: bool,
    /// Documents deleted so far, or in all once completed.
    pub deleted: u64,
    /// Documents the task found to delete.
    pub total: u64,
    /// Why the task failed: its error, or its per-document failures.
    pub failure: Option<String>,
}

/// Reads a background email delete task's progress.
pub async fn email_delete_task(
    client: &opensearch::OpenSearch,
    task_id: &str,
) -> Result<EmailDeleteTask> {
    const OPERATION: OpensearchOperation = OpensearchOperation::EmailDeleteTask;
    // The typed tasks API is behind the client's experimental feature.
    let response = client
        .send::<(), ()>(
            opensearch::http::Method::Get,
            &format!("/_tasks/{task_id}"),
            opensearch::http::headers::HeaderMap::new(),
            None,
            None,
            None,
        )
        .await
        .map_err(|err| OpensearchClientError::request_failed(OPERATION, &err))?;
    let status_code = response.status_code();
    let body = response
        .text()
        .await
        .map_err(|err| OpensearchClientError::deserialization_failed(OPERATION, &err))?;
    if !status_code.is_success() {
        return Err(OpensearchClientError::Unknown {
            details: body,
            operation: OPERATION,
        });
    }
    parse_email_delete_task(&body)
}

pub(crate) fn parse_email_delete_task(body: &str) -> Result<EmailDeleteTask> {
    let task: serde_json::Value =
        serde_json::from_str(body).map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            operation: OpensearchOperation::EmailDeleteTask,
        })?;
    let completed = task["completed"].as_bool().unwrap_or(false);
    let counts = if completed && task["response"].is_object() {
        &task["response"]
    } else {
        &task["task"]["status"]
    };
    let failure = if task["error"].is_object() {
        Some(task["error"].to_string())
    } else {
        task["response"]["failures"]
            .as_array()
            .filter(|failures| !failures.is_empty())
            .map(|failures| serde_json::Value::from(failures.clone()).to_string())
    };
    Ok(EmailDeleteTask {
        completed,
        deleted: counts["deleted"].as_u64().unwrap_or(0),
        total: counts["total"].as_u64().unwrap_or(0),
        failure,
    })
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

/// Deletes every document of one deleted message, whatever thread it was
/// indexed under, visible to search when this returns. Deleting it cannot go
/// stale, so a document another write changed mid-query is deleted on one
/// more pass, after a refresh lets that pass see the change.
pub async fn delete_email_message(
    client: &opensearch::OpenSearch,
    message_id: &str,
    index_override: Option<&str>,
) -> Result<EmailMessageDeleted> {
    let index = resolve_destination(index_override);
    let message_ids = [message_id.to_owned()];
    delete_with_recheck(
        || delete_by_message_ids(client, &message_ids, index),
        || refresh_index(client, index),
    )
    .await
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
    parse_deleted_by_query(&body, OPERATION)
}

/// Deletes `message_id`'s documents under every thread but `thread_id`: the
/// copies a message leaves behind when it moves to another thread. No refresh
/// is forced unless a copy changed mid-query: then the index is refreshed and
/// the delete runs once more, as for a single deleted message. A copy written
/// within the last refresh interval, or after this returns, is not seen and
/// stays until the message's next delete.
pub async fn delete_email_message_outside_thread(
    client: &opensearch::OpenSearch,
    message_id: &str,
    thread_id: &str,
) -> Result<EmailMessageDeleted> {
    let index = SearchIndex::Emails.as_ref();
    delete_with_recheck(
        || delete_outside_thread_pass(client, message_id, thread_id, index),
        || refresh_index(client, index),
    )
    .await
}

async fn delete_outside_thread_pass(
    client: &opensearch::OpenSearch,
    message_id: &str,
    thread_id: &str,
    index: &str,
) -> Result<DeletedByQuery> {
    const OPERATION: OpensearchOperation = OpensearchOperation::DeleteEmailMessageOutsideThread;
    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[index]))
        .body(outside_thread_query(message_id, thread_id))
        .conflicts(opensearch::params::Conflicts::Proceed)
        .send()
        .await
        .map_err(|err| OpensearchClientError::request_failed(OPERATION, &err))?;
    let status_code = response.status_code();
    let body = response
        .text()
        .await
        .map_err(|err| OpensearchClientError::deserialization_failed(OPERATION, &err))?;
    if !status_code.is_success() {
        tracing::error!(status_code = ?status_code, body = ?body, "error deleting a moved message's old copies");
        return Err(OpensearchClientError::Unknown {
            details: body,
            operation: OPERATION,
        });
    }
    parse_deleted_by_query(&body, OPERATION)
}

pub(crate) fn outside_thread_query(message_id: &str, thread_id: &str) -> serde_json::Value {
    serde_json::json!({
        "query": {
            "bool": {
                "filter": [{ "term": { "message_id": message_id } }],
                "must_not": [{ "term": { "entity_id": thread_id } }]
            }
        }
    })
}

/// Reads a delete-by-query response; per-document failures other than the
/// version conflicts `conflicts=proceed` counts fail the call.
pub(crate) fn parse_deleted_by_query(
    body: &str,
    operation: OpensearchOperation,
) -> Result<DeletedByQuery> {
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            operation,
        })?;
    if value["failures"]
        .as_array()
        .is_some_and(|failures| !failures.is_empty())
    {
        return Err(OpensearchClientError::Unknown {
            details: value["failures"].to_string(),
            operation,
        });
    }
    serde_json::from_value(value).map_err(|err| OpensearchClientError::DeserializationFailed {
        details: err.to_string(),
        operation,
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
