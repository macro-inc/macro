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

/// The id OpenSearch gives a background task, `<node id>:<task number>`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct EmailDeleteTaskId(String);

impl EmailDeleteTaskId {
    /// The id as OpenSearch writes it.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for EmailDeleteTaskId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl TryFrom<String> for EmailDeleteTaskId {
    type Error = String;

    fn try_from(id: String) -> std::result::Result<Self, Self::Error> {
        match id.split_once(':') {
            Some((node, number))
                if !node.is_empty()
                    && !number.is_empty()
                    && number.bytes().all(|byte| byte.is_ascii_digit()) =>
            {
                Ok(Self(id))
            }
            _ => Err(format!("not an OpenSearch task id: {id}")),
        }
    }
}

/// The `X-Opaque-Id` an inbox's delete task carries, so it can be found again.
fn email_link_delete_opaque_id(link_id: &str) -> String {
    format!("email-link-delete:{link_id}")
}

/// Starts deleting every email document of an inbox as a background
/// OpenSearch task and returns its id without waiting. The task is throttled
/// to `docs_per_second` across automatic slices, skips documents changed
/// mid-delete instead of aborting, and forces no refresh: the scheduled
/// refresh makes the removals visible. The throttle is per task, so callers
/// bound how many run at once.
pub async fn start_email_link_delete(
    client: &opensearch::OpenSearch,
    link_id: &str,
    docs_per_second: i64,
) -> Result<EmailDeleteTaskId> {
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
        .header(
            opensearch::http::headers::HeaderName::from_static("x-opaque-id"),
            opensearch::http::headers::HeaderValue::from_str(&email_link_delete_opaque_id(link_id))
                .map_err(|err| OpensearchClientError::SerializationFailed {
                    details: err.to_string(),
                    operation: OPERATION,
                })?,
        )
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
    parse_started_task(&body)
}

pub(crate) fn parse_started_task(body: &str) -> Result<EmailDeleteTaskId> {
    const OPERATION: OpensearchOperation = OpensearchOperation::StartEmailLinkDelete;
    let started: serde_json::Value =
        serde_json::from_str(body).map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            operation: OPERATION,
        })?;
    started["task"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| format!("no task id in {body}"))
        .and_then(EmailDeleteTaskId::try_from)
        .map_err(|details| OpensearchClientError::DeserializationFailed {
            details,
            operation: OPERATION,
        })
}

/// The inbox delete task OpenSearch is running for `link_id`, if any.
pub async fn running_email_link_delete(
    client: &opensearch::OpenSearch,
    link_id: &str,
) -> Result<Option<EmailDeleteTaskId>> {
    const OPERATION: OpensearchOperation = OpensearchOperation::RunningEmailLinkDeletes;
    const QUERY: &[(&str, &str)] = &[
        ("actions", "indices:data/write/delete/byquery"),
        ("detailed", "true"),
        ("group_by", "none"),
        ("timeout", "10s"),
    ];
    let response = client
        .send::<(), [(&str, &str)]>(
            opensearch::http::Method::Get,
            "/_tasks",
            opensearch::http::headers::HeaderMap::new(),
            Some(QUERY),
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
    parse_running_email_link_delete(&body, link_id)
}

/// The top-level task in a `_tasks?group_by=none` listing that carries
/// `link_id`'s opaque id. A sliced delete's slices share the header but name
/// their parent, so they are skipped. A listing some node failed to answer is
/// an error: the task could be on that node.
pub(crate) fn parse_running_email_link_delete(
    body: &str,
    link_id: &str,
) -> Result<Option<EmailDeleteTaskId>> {
    const OPERATION: OpensearchOperation = OpensearchOperation::RunningEmailLinkDeletes;
    let listing: serde_json::Value =
        serde_json::from_str(body).map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            operation: OPERATION,
        })?;
    let failed = |key: &str| {
        listing[key]
            .as_array()
            .is_some_and(|failures| !failures.is_empty())
    };
    if failed("node_failures") || failed("task_failures") {
        return Err(OpensearchClientError::Unknown {
            details: format!("incomplete task listing: {body}"),
            operation: OPERATION,
        });
    }
    let opaque_id = email_link_delete_opaque_id(link_id);
    let Some(tasks) = listing["tasks"].as_array() else {
        return Ok(None);
    };
    let found = tasks.iter().find(|task| {
        task["parent_task_id"].is_null()
            && task["headers"]["X-Opaque-Id"].as_str() == Some(&opaque_id)
    });
    match found {
        None => Ok(None),
        Some(task) => {
            let id = format!(
                "{}:{}",
                task["node"].as_str().unwrap_or_default(),
                task["id"]
                    .as_u64()
                    .map(|id| id.to_string())
                    .unwrap_or_default()
            );
            EmailDeleteTaskId::try_from(id)
                .map(Some)
                .map_err(|details| OpensearchClientError::DeserializationFailed {
                    details,
                    operation: OPERATION,
                })
        }
    }
}

/// Progress of a background email delete task.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmailDeleteTask {
    /// Documents deleted so far, or in all once the task ended.
    pub deleted: u64,
    /// Documents the task found to delete.
    pub total: u64,
    /// Where the task is.
    pub state: EmailDeleteState,
}

/// Where a background email delete task is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EmailDeleteState {
    /// Still deleting.
    Running,
    /// Deleted everything it found.
    Completed,
    /// Ended without deleting everything: an error, per-document failures,
    /// or a timeout. Holds a short description.
    Failed(String),
    /// Someone cancelled it. Holds the reason OpenSearch recorded.
    Canceled(String),
}

/// Reads a background email delete task's progress, or `None` when
/// OpenSearch knows no task by that id.
pub async fn email_delete_task(
    client: &opensearch::OpenSearch,
    task_id: &EmailDeleteTaskId,
) -> Result<Option<EmailDeleteTask>> {
    const OPERATION: OpensearchOperation = OpensearchOperation::EmailDeleteTask;
    // The typed tasks API is behind the opensearch crate's experimental feature.
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
    if status_code == opensearch::http::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !status_code.is_success() {
        return Err(OpensearchClientError::Unknown {
            details: body,
            operation: OPERATION,
        });
    }
    parse_email_delete_task(&body).map(Some)
}

pub(crate) fn parse_email_delete_task(body: &str) -> Result<EmailDeleteTask> {
    let task: serde_json::Value =
        serde_json::from_str(body).map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            operation: OpensearchOperation::EmailDeleteTask,
        })?;
    let completed = task["completed"].as_bool().unwrap_or(false);
    let response = &task["response"];
    let counts = if completed && response.is_object() {
        response
    } else {
        &task["task"]["status"]
    };
    let state = if !completed {
        EmailDeleteState::Running
    } else if task["error"].is_object() {
        EmailDeleteState::Failed(describe_error(&task["error"]))
    } else if let Some(reason) = response["canceled"]
        .as_str()
        .filter(|reason| !reason.is_empty())
    {
        EmailDeleteState::Canceled(reason.to_owned())
    } else if let Some(failures) = response["failures"]
        .as_array()
        .filter(|failures| !failures.is_empty())
    {
        EmailDeleteState::Failed(format!(
            "{} failures, first: {}",
            failures.len(),
            describe_error(&failures[0]["cause"])
        ))
    } else if let Some(conflicts) = response["version_conflicts"]
        .as_u64()
        .filter(|&conflicts| conflicts > 0)
    {
        EmailDeleteState::Failed(format!(
            "{conflicts} documents changed while being deleted and were skipped"
        ))
    } else if response["timed_out"].as_bool().unwrap_or(false) {
        EmailDeleteState::Failed("timed out".to_owned())
    } else {
        EmailDeleteState::Completed
    };
    Ok(EmailDeleteTask {
        deleted: counts["deleted"].as_u64().unwrap_or(0),
        total: counts["total"].as_u64().unwrap_or(0),
        state,
    })
}

/// `type: reason` of an OpenSearch error object, without its nested causes.
fn describe_error(error: &serde_json::Value) -> String {
    let kind = error["type"].as_str().unwrap_or("unknown");
    match error["reason"].as_str() {
        Some(reason) => format!("{kind}: {reason}"),
        None => kind.to_owned(),
    }
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
/// indexed under, and forces a refresh only to recheck a copy that conflicted:
/// search stops finding the message at the index's next scheduled refresh.
/// The document under the event's thread is deleted by id, which finds it
/// even before a refresh has made it searchable. A delete-by-query then
/// removes copies under other threads, the query
/// [`delete_email_message_outside_thread`] runs; it leaves the event's thread
/// out, because its search still sees the document just deleted until the
/// next refresh and would count it as a conflict. Deleting cannot go stale, so a copy another
/// write changed mid-query, or deleted within one refresh interval, is
/// deleted on one more pass, after a refresh lets that pass see the change.
pub async fn delete_email_message(
    client: &opensearch::OpenSearch,
    message_id: &str,
    thread_id: &str,
    index_override: Option<&str>,
) -> Result<EmailMessageRemoved> {
    let index = resolve_destination(index_override);
    let document_id = crate::upsert::email::email_document_id(thread_id, message_id);
    let by_id = delete_document_by_id(client, &document_id, index).await?;
    let other_threads = delete_with_recheck(
        || delete_outside_thread_pass(client, message_id, thread_id, index),
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
fn is_missing_document(status_code: u16, body: &str) -> bool {
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

/// Refreshes the email index a delete targets, so the next search or
/// delete-by-query on it sees every write so far.
pub(crate) async fn refresh_destination(
    client: &opensearch::OpenSearch,
    index_override: Option<&str>,
) -> Result<()> {
    refresh_index(client, resolve_destination(index_override)).await
}

pub(crate) async fn refresh_index(client: &opensearch::OpenSearch, index: &str) -> Result<()> {
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
