use models_opensearch::SearchIndex;

use crate::{
    Result,
    error::{OpensearchClientError, OpensearchOperation},
    upsert::email::EmailDocumentKey,
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

/// Documents one page of a copy search returns. A message has a document
/// under each thread it was ever indexed under, a handful at most; a search
/// names the removed messages of one thread page or batch, and pages on until
/// it has every match.
pub(crate) const MESSAGE_DOCUMENTS_PER_PAGE: usize = 1_000;

/// The documents of `message_ids` under any thread but `keep_thread_ids`, as of
/// the index's last refresh: the copies a message leaves when it moves to
/// another thread, and every copy of a deleted message when `keep_thread_ids`
/// is empty. It pages through every match, and fails rather than return part
/// of them when a shard fails or the search times out. A copy written within
/// the last refresh interval is not found and stays until the message's next
/// delete.
pub(crate) async fn email_message_documents(
    client: &opensearch::OpenSearch,
    message_ids: &[String],
    keep_thread_ids: &[String],
    index_override: Option<&str>,
) -> Result<Vec<EmailDocumentKey>> {
    const OPERATION: OpensearchOperation = OpensearchOperation::FindEmailMessageDocuments;
    if message_ids.is_empty() {
        return Ok(Vec::new());
    }
    let index = resolve_destination(index_override);
    let mut found = Vec::new();
    let mut after = None;
    loop {
        let response = client
            .search(opensearch::SearchParts::Index(&[index]))
            .allow_partial_search_results(false)
            .body(message_documents_query(
                message_ids,
                keep_thread_ids,
                after.as_ref(),
            ))
            .send()
            .await
            .map_err(|err| OpensearchClientError::request_failed(OPERATION, &err))?;
        let status_code = response.status_code();
        let body = response
            .text()
            .await
            .map_err(|err| OpensearchClientError::deserialization_failed(OPERATION, &err))?;
        if !status_code.is_success() {
            tracing::error!(status_code = ?status_code, body = ?body, "error finding an email message's documents");
            return Err(OpensearchClientError::Unknown {
                details: body,
                operation: OPERATION,
            });
        }
        let page = parse_message_documents(&body)?;
        let full = page.keys.len() >= MESSAGE_DOCUMENTS_PER_PAGE;
        found.extend(page.keys);
        match (full, page.last) {
            (true, Some(last)) => after = Some(last),
            _ => return Ok(found),
        }
    }
}

/// The sort values of a page's last hit, where the next page starts.
type SearchAfter = serde_json::Value;

pub(crate) fn message_documents_query(
    message_ids: &[String],
    keep_thread_ids: &[String],
    after: Option<&SearchAfter>,
) -> serde_json::Value {
    let mut query = serde_json::json!({
        "size": MESSAGE_DOCUMENTS_PER_PAGE,
        "_source": ["entity_id", "message_id"],
        "sort": [{ "message_id": "asc" }, { "entity_id": "asc" }],
        "query": {
            "bool": {
                "filter": [{ "terms": { "message_id": message_ids } }],
                "must_not": [{ "terms": { "entity_id": keep_thread_ids } }]
            }
        }
    });
    if let Some(after) = after {
        query["search_after"] = after.clone();
    }
    query
}

#[derive(serde::Deserialize)]
struct MessageDocumentHits {
    #[serde(default)]
    timed_out: bool,
    #[serde(rename = "_shards")]
    shards: Option<ShardCounts>,
    hits: MessageDocumentHitList,
}

#[derive(serde::Deserialize)]
struct ShardCounts {
    #[serde(default)]
    failed: u64,
}

#[derive(serde::Deserialize)]
struct MessageDocumentHitList {
    hits: Vec<MessageDocumentHit>,
}

#[derive(serde::Deserialize)]
struct MessageDocumentHit {
    #[serde(rename = "_source")]
    source: MessageDocumentSource,
    #[serde(default)]
    sort: Option<SearchAfter>,
}

#[derive(serde::Deserialize)]
struct MessageDocumentSource {
    entity_id: String,
    message_id: String,
}

/// One page of a copy search.
pub(crate) struct MessageDocumentsPage {
    pub(crate) keys: Vec<EmailDocumentKey>,
    /// The last hit's sort values.
    pub(crate) last: Option<SearchAfter>,
}

pub(crate) fn parse_message_documents(body: &str) -> Result<MessageDocumentsPage> {
    const OPERATION: OpensearchOperation = OpensearchOperation::FindEmailMessageDocuments;
    let found: MessageDocumentHits =
        serde_json::from_str(body).map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            operation: OPERATION,
        })?;
    let failed_shards = found.shards.map_or(0, |shards| shards.failed);
    if found.timed_out || failed_shards > 0 {
        return Err(OpensearchClientError::Unknown {
            details: format!(
                "incomplete copy search: timed_out {}, failed shards {failed_shards}",
                found.timed_out
            ),
            operation: OPERATION,
        });
    }
    let last = found.hits.hits.last().and_then(|hit| hit.sort.clone());
    Ok(MessageDocumentsPage {
        keys: found
            .hits
            .hits
            .into_iter()
            .map(|hit| EmailDocumentKey {
                thread_id: hit.source.entity_id,
                message_id: hit.source.message_id,
            })
            .collect(),
        last,
    })
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

/// Documents a delete-by-query removed, and those it skipped because another
/// write changed them between its search and delete.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
pub struct DeletedByQuery {
    #[serde(default)]
    pub deleted: u64,
    #[serde(default)]
    pub version_conflicts: u64,
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
