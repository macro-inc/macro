//! DynamoDB-backed registry of long-running backfill jobs.
//!
//! Backfills can take many minutes for prod-scale entities — well past the
//! ALB idle timeout — so the HTTP handler kicks the orchestrator onto a
//! background tokio task and returns a [`JobId`] right away. Clients poll
//! [`BackfillJobs::snapshot`] for progress; the orchestrator updates the
//! shared [`JobProgress`] (`UpdateItem ADD enqueued`) as each page lands.
//!
//! Why DynamoDB: SPS scales between 1 and 10 ECS tasks with no ALB
//! stickiness, so a status poll can land on a different instance from the
//! one that handled the POST. An in-memory registry would 404 in that
//! case. DynamoDB gives us a shared store with native TTL for cleanup and
//! pay-per-request pricing — no infra to provision.
//!
//! Each job is one item keyed on `id`. Items carry an `expires_at` epoch
//! attribute that DynamoDB's background TTL process sweeps. The
//! `Cancelled` status is a best-effort signal: cancellation tokens are
//! per-instance (kept in a local `HashMap`) since they don't replicate
//! across pods, so SIGTERM only stops jobs running on that pod. Since
//! workers re-index idempotently, a cancelled-but-not-recorded backfill
//! is recoverable by re-kicking it.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;

use aws_sdk_dynamodb::Client;
use aws_sdk_dynamodb::types::AttributeValue;
use chrono::{DateTime, Utc};
use ensure_exists::EnsureExists;
use ensure_exists::dynamodb::{CreateTableErr, DefineTable, DynamoClientWrapper};
use serde::Serialize;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::models::{BackfillError, BackfillReceipt};

/// Opaque identifier the API hands back when a backfill is queued.
#[derive(Debug, Clone, Eq, PartialEq, Hash, Serialize)]
#[serde(transparent)]
pub struct JobId(String);

impl JobId {
    pub fn new() -> Self {
        Self(Uuid::new_v4().to_string())
    }
}

impl From<String> for JobId {
    fn from(s: String) -> Self {
        Self(s)
    }
}

impl std::fmt::Display for JobId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Newtype around the table name so `DefineTable` knows what to create.
/// Used by [`BackfillJobs::ensure_table`] for local-dev table bootstrap;
/// in deployed environments Pulumi creates the table.
#[derive(Debug, Clone)]
pub struct BackfillJobsTable(Arc<str>);

impl AsRef<str> for BackfillJobsTable {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl DefineTable for BackfillJobsTable {
    async fn create_table(&self, client: &aws_sdk_dynamodb::Client) -> Result<(), CreateTableErr> {
        client
            .create_table()
            .table_name(self.as_ref())
            .key_schema(
                aws_sdk_dynamodb::types::KeySchemaElement::builder()
                    .attribute_name("id")
                    .key_type(aws_sdk_dynamodb::types::KeyType::Hash)
                    .build()
                    .map_err(aws_sdk_dynamodb::Error::from)?,
            )
            .attribute_definitions(
                aws_sdk_dynamodb::types::AttributeDefinition::builder()
                    .attribute_name("id")
                    .attribute_type(aws_sdk_dynamodb::types::ScalarAttributeType::S)
                    .build()
                    .map_err(aws_sdk_dynamodb::Error::from)?,
            )
            .billing_mode(aws_sdk_dynamodb::types::BillingMode::PayPerRequest)
            .send()
            .await
            .map_err(aws_sdk_dynamodb::Error::from)?;
        Ok(())
    }
}

/// Per-page progress hook handed to the orchestrator.
///
/// Two backends so `drain_source` doesn't need to know whether it's running
/// against a real DynamoDB or a unit-test fake:
///
/// - `Detached` — records progress in process memory. Used by tests.
/// - `Dynamo` — fires `UpdateItem ADD enqueued :n` per page. Page bounds
///   are the same point the cancellation token is checked, so the round
///   trip cost is amortised over the page work.
pub struct JobProgress {
    backend: ProgressBackend,
}

enum ProgressBackend {
    #[cfg(test)]
    Detached(Mutex<DetachedProgress>),
    Dynamo {
        client: Client,
        table: Arc<str>,
        id: JobId,
    },
}

/// What a detached [`JobProgress`] has recorded.
#[cfg(test)]
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct DetachedProgress {
    pub enqueued: usize,
    pub cursor: Option<String>,
    pub updated: usize,
    pub missing: usize,
    pub failed: usize,
    pub not_queued: usize,
}

/// Moves a job's cursor and adds one page's counts in a single write.
const RECORD_PAGE_EXPRESSION: &str = "SET #cursor = :cursor \
     ADD enqueued :processed, #updated :updated, #missing :missing, #failed :failed";

/// What one page of a resumable backfill finished, recorded on its job.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PageProgress<'a> {
    /// The last key the page covered; the job resumes after it.
    pub cursor: &'a str,
    /// Source rows the page read, added to `enqueued`.
    pub processed: usize,
    /// Index documents the page changed.
    pub updated: usize,
    /// Source rows with no index document to change.
    pub missing: usize,
    /// Index documents the page failed to change.
    pub failed: usize,
}

impl JobProgress {
    /// In-memory progress for tests. Production always uses the DynamoDB
    /// backend so other instances can read the live counter.
    #[cfg(test)]
    pub fn detached() -> Self {
        Self {
            backend: ProgressBackend::Detached(Mutex::new(DetachedProgress::default())),
        }
    }

    fn dynamo(client: Client, table: Arc<str>, id: JobId) -> Self {
        Self {
            backend: ProgressBackend::Dynamo { client, table, id },
        }
    }

    /// Add `n` to the running enqueued count. Best effort against
    /// DynamoDB: a failed write logs and continues so a transient blip
    /// doesn't kill the whole drain (the next page's `ADD` reconciles).
    pub async fn add(&self, n: usize) {
        #[cfg(test)]
        if let ProgressBackend::Detached(progress) = &self.backend {
            progress.lock().unwrap().enqueued += n;
            return;
        }
        self.add_to_counter("enqueued", n).await;
    }

    /// Add `n` to the messages the search event queue would not take. Best
    /// effort like [`Self::add`]; the job's terminal status does not depend
    /// on it.
    pub async fn add_not_queued(&self, n: usize) {
        #[cfg(test)]
        if let ProgressBackend::Detached(progress) = &self.backend {
            progress.lock().unwrap().not_queued += n;
            return;
        }
        self.add_to_counter("not_queued", n).await;
    }

    async fn add_to_counter(&self, counter: &'static str, n: usize) {
        let (client, table, id) = match &self.backend {
            #[cfg(test)]
            ProgressBackend::Detached(_) => return,
            ProgressBackend::Dynamo { client, table, id } => (client, table, id),
        };
        let result = client
            .update_item()
            .table_name(table.as_ref())
            .key("id", AttributeValue::S(id.0.clone()))
            .update_expression("ADD #counter :n")
            .expression_attribute_names("#counter", counter)
            .expression_attribute_values(":n", AttributeValue::N(n.to_string()))
            .send()
            .await;
        if let Err(e) = result {
            tracing::warn!(error=?e, id=%id, counter, "failed to update backfill progress in dynamodb");
        }
    }

    /// Record a finished page of a resumable backfill: move the job's cursor
    /// to the page's last key and add its counts. Best effort like
    /// [`Self::add`]: a lost write leaves the cursor one page behind, and
    /// resuming from there repeats only idempotent work.
    pub async fn record_page(&self, page: PageProgress<'_>) {
        match &self.backend {
            #[cfg(test)]
            ProgressBackend::Detached(progress) => {
                let mut progress = progress.lock().unwrap();
                progress.enqueued += page.processed;
                progress.cursor = Some(page.cursor.to_owned());
                progress.updated += page.updated;
                progress.missing += page.missing;
                progress.failed += page.failed;
            }
            ProgressBackend::Dynamo { client, table, id } => {
                let count = |n: usize| AttributeValue::N(n.to_string());
                let result = client
                    .update_item()
                    .table_name(table.as_ref())
                    .key("id", AttributeValue::S(id.0.clone()))
                    .update_expression(RECORD_PAGE_EXPRESSION)
                    .expression_attribute_names("#cursor", "cursor")
                    .expression_attribute_names("#updated", "updated")
                    .expression_attribute_names("#missing", "missing")
                    .expression_attribute_names("#failed", "failed")
                    .expression_attribute_values(
                        ":cursor",
                        AttributeValue::S(page.cursor.to_owned()),
                    )
                    .expression_attribute_values(":processed", count(page.processed))
                    .expression_attribute_values(":updated", count(page.updated))
                    .expression_attribute_values(":missing", count(page.missing))
                    .expression_attribute_values(":failed", count(page.failed))
                    .send()
                    .await;
                if let Err(e) = result {
                    tracing::warn!(error=?e, id=%id, "failed to record backfill page in dynamodb");
                }
            }
        }
    }

    /// The registry id of the job this progress belongs to.
    pub fn job_id(&self) -> Option<&JobId> {
        match &self.backend {
            #[cfg(test)]
            ProgressBackend::Detached(_) => None,
            ProgressBackend::Dynamo { id, .. } => Some(id),
        }
    }

    #[cfg(test)]
    pub fn local_count(&self) -> usize {
        self.local_progress().enqueued
    }

    #[cfg(test)]
    pub fn local_progress(&self) -> DetachedProgress {
        match &self.backend {
            ProgressBackend::Detached(progress) => progress.lock().unwrap().clone(),
            ProgressBackend::Dynamo { .. } => DetachedProgress::default(),
        }
    }
}

/// Terminal state of a tracked job. `Running` is the only non-terminal
/// variant; the others are written exactly once when the worker future
/// resolves or is cancelled.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
    /// The search index refused writes and the job stopped instead of
    /// retrying; resume it from its `cursor` once the index recovers.
    Stopped,
}

impl JobStatus {
    fn as_str(self) -> &'static str {
        match self {
            JobStatus::Running => "running",
            JobStatus::Completed => "completed",
            JobStatus::Failed => "failed",
            JobStatus::Cancelled => "cancelled",
            JobStatus::Stopped => "stopped",
        }
    }

    fn from_str(s: &str) -> Option<Self> {
        match s {
            "running" => Some(JobStatus::Running),
            "completed" => Some(JobStatus::Completed),
            "failed" => Some(JobStatus::Failed),
            "cancelled" => Some(JobStatus::Cancelled),
            "stopped" => Some(JobStatus::Stopped),
            _ => None,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct JobSnapshot {
    pub job_id: JobId,
    pub status: JobStatus,
    pub enqueued: usize,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    /// Populated when `status` is `failed` or `stopped`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// The last key a resumable backfill finished; pass it back to resume
    /// after it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    /// Index documents changed, for a backfill that updates the index directly.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated: Option<usize>,
    /// Source rows with no index document to change.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing: Option<usize>,
    /// Index documents the backfill failed to change.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed: Option<usize>,
    /// Messages the search event queue would not take after resends; a job
    /// with any is `failed`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub not_queued: Option<usize>,
}

/// Bag of state the spawning code needs after [`BackfillJobs::start`]: the
/// id to hand back over HTTP, the progress hook to thread into the
/// orchestrator, and the token to wire to a `select!` for shutdown.
pub struct JobHandle {
    pub id: JobId,
    pub progress: Arc<JobProgress>,
    pub cancel: CancellationToken,
}

/// Async-shareable registry of backfill jobs, backed by DynamoDB. Cheap to
/// clone — the SDK `Client` is internally `Arc`-y and the local cancel
/// map sits behind one `Arc<Mutex<…>>`.
#[derive(Clone)]
pub struct BackfillJobs {
    client: Client,
    table: Arc<str>,
    /// Per-instance cancellation tokens. Cancellation does not replicate
    /// across pods (we have no cancel endpoint, and the token is the only
    /// mechanism `drain_source` checks). Entries are removed on `finish`.
    local_cancels: Arc<Mutex<HashMap<JobId, CancellationToken>>>,
    ttl: Duration,
}

impl BackfillJobs {
    pub fn new(client: Client, table: impl Into<Arc<str>>, ttl: Duration) -> Self {
        Self {
            client,
            table: table.into(),
            local_cancels: Arc::new(Mutex::new(HashMap::new())),
            ttl,
        }
    }

    /// Create the DynamoDB table if it doesn't exist. Used in local
    /// development against the dynamodb-local container; in deployed
    /// environments Pulumi owns the table and this is a no-op (DescribeTable
    /// finds it and returns).
    pub async fn ensure_table(&self) -> anyhow::Result<()> {
        let table = BackfillJobsTable(self.table.clone());
        let wrapper = DynamoClientWrapper {
            client: &self.client,
            table_name: table,
        };
        wrapper.ensure_exists().await?;
        Ok(())
    }

    /// Allocate a new job slot and return the handle the spawning code
    /// needs to drive and observe it. Writes the initial item with TTL
    /// before returning so a subsequent status poll can find it.
    pub async fn start(&self, entity: &str) -> anyhow::Result<JobHandle> {
        let id = JobId::new();
        let started_at = Utc::now();
        let expires_at = started_at + chrono::Duration::from_std(self.ttl)?;

        self.client
            .put_item()
            .table_name(self.table.as_ref())
            .item("id", AttributeValue::S(id.0.clone()))
            .item(
                "status",
                AttributeValue::S(JobStatus::Running.as_str().to_string()),
            )
            .item("enqueued", AttributeValue::N("0".to_string()))
            .item("started_at", AttributeValue::S(started_at.to_rfc3339()))
            .item("entity", AttributeValue::S(entity.to_string()))
            .item(
                "expires_at",
                AttributeValue::N(expires_at.timestamp().to_string()),
            )
            .send()
            .await?;

        let cancel = CancellationToken::new();
        self.local_cancels
            .lock()
            .unwrap()
            .insert(id.clone(), cancel.clone());

        Ok(JobHandle {
            id: id.clone(),
            progress: Arc::new(JobProgress::dynamo(
                self.client.clone(),
                self.table.clone(),
                id,
            )),
            cancel,
        })
    }

    /// Record the orchestrator's terminal result. Treats an `Ok` after the
    /// token fired as `Cancelled` so a clean `select!` exit still surfaces
    /// to the status endpoint, and a [`BackfillError::Stopped`] as `Stopped`
    /// with its cursor, and an `Ok` that left messages off the queue as
    /// `Failed`, cancelled or not. Drops the local cancellation entry — a finished job
    /// can no longer be cancelled.
    pub async fn finish(
        &self,
        id: &JobId,
        result: Result<BackfillReceipt, BackfillError>,
    ) -> anyhow::Result<()> {
        let was_cancelled = self
            .local_cancels
            .lock()
            .unwrap()
            .remove(id)
            .is_some_and(|t| t.is_cancelled());

        let (status, error, cursor) = terminal_state(result, was_cancelled);

        let mut update = self
            .client
            .update_item()
            .table_name(self.table.as_ref())
            .key("id", AttributeValue::S(id.0.clone()))
            .expression_attribute_names("#s", "status")
            .expression_attribute_values(":s", AttributeValue::S(status.as_str().to_string()))
            .expression_attribute_values(":f", AttributeValue::S(Utc::now().to_rfc3339()));

        let mut assignments = vec!["#s = :s", "finished_at = :f"];
        if let Some(e) = error {
            update = update
                .expression_attribute_names("#e", "error")
                .expression_attribute_values(":e", AttributeValue::S(e));
            assignments.push("#e = :e");
        }
        // A job stopped before it finished a page has not recorded the
        // cursor it started from.
        if let Some(cursor) = cursor {
            update = update
                .expression_attribute_names("#cursor", "cursor")
                .expression_attribute_values(":cursor", AttributeValue::S(cursor));
            assignments.push("#cursor = :cursor");
        }

        update
            .update_expression(format!("SET {}", assignments.join(", ")))
            .send()
            .await?;
        Ok(())
    }

    /// Read the current state of a job from DynamoDB. `Ok(None)` when the
    /// item has expired or never existed.
    pub async fn snapshot(&self, id: &JobId) -> anyhow::Result<Option<JobSnapshot>> {
        let resp = self
            .client
            .get_item()
            .table_name(self.table.as_ref())
            .key("id", AttributeValue::S(id.0.clone()))
            .send()
            .await?;
        let Some(item) = resp.item else {
            return Ok(None);
        };

        let status = item
            .get("status")
            .and_then(|v| v.as_s().ok())
            .and_then(|s| JobStatus::from_str(s))
            .unwrap_or(JobStatus::Running);
        let enqueued: usize = item
            .get("enqueued")
            .and_then(|v| v.as_n().ok())
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let started_at = item
            .get("started_at")
            .and_then(|v| v.as_s().ok())
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(Utc::now);
        let finished_at = item
            .get("finished_at")
            .and_then(|v| v.as_s().ok())
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&Utc));
        let error = item
            .get("error")
            .and_then(|v| v.as_s().ok())
            .map(|s| s.to_string());
        let cursor = item
            .get("cursor")
            .and_then(|v| v.as_s().ok())
            .map(|s| s.to_string());
        let count = |name: &str| {
            item.get(name)
                .and_then(|v| v.as_n().ok())
                .and_then(|s| s.parse().ok())
        };

        Ok(Some(JobSnapshot {
            job_id: id.clone(),
            status,
            enqueued,
            started_at,
            finished_at,
            error,
            cursor,
            updated: count("updated"),
            missing: count("missing"),
            failed: count("failed"),
            not_queued: count("not_queued"),
        }))
    }

    /// Fire every locally tracked cancellation token. Used on graceful
    /// shutdown so drains stop between pages instead of being killed
    /// mid-publish when the runtime exits. Cancellation does not propagate
    /// across pods — that'd require a cancel endpoint we don't have.
    pub fn cancel_all_local(&self) {
        let guard = self.local_cancels.lock().unwrap();
        for cancel in guard.values() {
            cancel.cancel();
        }
    }
}

/// The status, error and cursor a finished job records.
fn terminal_state(
    result: Result<BackfillReceipt, BackfillError>,
    was_cancelled: bool,
) -> (JobStatus, Option<String>, Option<String>) {
    match result {
        Ok(receipt) if receipt.not_queued > 0 => (
            JobStatus::Failed,
            Some(format!(
                "the search event queue refused {} of the backfill's messages",
                receipt.not_queued
            )),
            None,
        ),
        Ok(_) if was_cancelled => (JobStatus::Cancelled, None, None),
        Ok(_) => (JobStatus::Completed, None, None),
        Err(e) => {
            let (status, cursor) = match &e {
                BackfillError::Stopped { cursor, .. } => (JobStatus::Stopped, cursor.clone()),
                _ => (JobStatus::Failed, None),
            };
            (status, Some(format!("{e}")), cursor)
        }
    }
}

#[cfg(test)]
mod test;
