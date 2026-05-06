//! Redis-backed registry of long-running backfill jobs.
//!
//! Backfills can take many minutes for prod-scale entities — well past the
//! ALB idle timeout — so the HTTP handler kicks the orchestrator onto a
//! background tokio task and returns a [`JobId`] right away. Clients poll
//! [`BackfillJobs::snapshot`] for progress; the orchestrator updates the
//! shared [`JobProgress`] (HINCRBY into the same Redis hash) as each page
//! lands.
//!
//! Why Redis: SPS scales between 1 and 10 ECS tasks with no ALB stickiness,
//! so a status poll can land on a different instance from the one that
//! handled the POST. An in-memory registry would 404 in that case.
//!
//! Each job is one Redis hash at `sps:backfill:job:{id}`. A TTL set on
//! creation acts as the cleanup mechanism — nothing GCs by hand. The
//! `Cancelled` status is a best-effort signal: cancellation tokens are
//! per-instance (kept in a local `HashMap`) since they don't replicate
//! across pods, so SIGTERM only stops jobs running on that pod. Since
//! workers re-index idempotently, a cancelled-but-not-recorded backfill is
//! recoverable by re-kicking it.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;
#[cfg(test)]
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use chrono::{DateTime, Utc};
use redis::{AsyncCommands, aio::ConnectionManager};
use serde::Serialize;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::models::{BackfillError, BackfillReceipt};

/// Redis key prefix for every backfill job hash. Bumping this is the same
/// as wiping all in-flight + recent jobs (keys with the old prefix simply
/// expire on their own).
const KEY_PREFIX: &str = "sps:backfill:job:";

fn job_key(id: &JobId) -> String {
    format!("{KEY_PREFIX}{}", id.0)
}

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

/// Per-page progress hook handed to the orchestrator.
///
/// Two backends so `drain_source` doesn't need to know whether it's running
/// against a real Redis or a unit-test fake:
///
/// - `Detached` — bumps an in-process atomic. Used by tests (and as a
///   degraded fallback if we ever need it).
/// - `Redis` — fires `HINCRBY sps:backfill:job:{id} enqueued <n>` per page.
///   A page is the same boundary the cancellation token is checked at, so
///   the round trip cost is amortised over the page work.
pub struct JobProgress {
    backend: ProgressBackend,
}

enum ProgressBackend {
    #[cfg(test)]
    Detached(AtomicUsize),
    Redis {
        conn: ConnectionManager,
        key: String,
    },
}

impl JobProgress {
    /// In-memory progress for tests. Production always uses the Redis
    /// backend so other instances can read the live counter.
    #[cfg(test)]
    pub fn detached() -> Self {
        Self {
            backend: ProgressBackend::Detached(AtomicUsize::new(0)),
        }
    }

    fn redis(conn: ConnectionManager, key: String) -> Self {
        Self {
            backend: ProgressBackend::Redis { conn, key },
        }
    }

    /// Add `n` to the running enqueued count. Best effort against Redis: a
    /// failed write logs and continues so a transient blip doesn't kill the
    /// whole drain (the next page's HINCRBY will reconcile).
    pub async fn add(&self, n: usize) {
        match &self.backend {
            #[cfg(test)]
            ProgressBackend::Detached(a) => {
                a.fetch_add(n, Ordering::Relaxed);
            }
            ProgressBackend::Redis { conn, key } => {
                let mut conn = conn.clone();
                let result: redis::RedisResult<i64> =
                    conn.hincr(key.as_str(), "enqueued", n as i64).await;
                if let Err(e) = result {
                    tracing::warn!(error=?e, key=%key, "failed to update backfill progress in redis");
                }
            }
        }
    }

    /// Test-only accessor for the in-memory count. Always 0 for the Redis
    /// backend (the snapshot endpoint reads from Redis directly).
    #[cfg(test)]
    pub fn local_count(&self) -> usize {
        match &self.backend {
            ProgressBackend::Detached(a) => a.load(Ordering::Relaxed),
            ProgressBackend::Redis { .. } => 0,
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
}

impl JobStatus {
    fn as_str(self) -> &'static str {
        match self {
            JobStatus::Running => "running",
            JobStatus::Completed => "completed",
            JobStatus::Failed => "failed",
            JobStatus::Cancelled => "cancelled",
        }
    }

    fn from_str(s: &str) -> Option<Self> {
        match s {
            "running" => Some(JobStatus::Running),
            "completed" => Some(JobStatus::Completed),
            "failed" => Some(JobStatus::Failed),
            "cancelled" => Some(JobStatus::Cancelled),
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
    /// Populated when `status == Failed`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Bag of state the spawning code needs after [`BackfillJobs::start`]: the
/// id to hand back over HTTP, the progress hook to thread into the
/// orchestrator, and the token to wire to a `select!` for shutdown.
pub struct JobHandle {
    pub id: JobId,
    pub progress: Arc<JobProgress>,
    pub cancel: CancellationToken,
}

/// Async-shareable registry of backfill jobs, backed by Redis. Cheap to
/// clone — the `ConnectionManager` is internally `Arc`-y and the local
/// cancel map sits behind one `Arc<Mutex<…>>`.
#[derive(Clone)]
pub struct BackfillJobs {
    redis: ConnectionManager,
    /// Per-instance cancellation tokens. Cancellation does not replicate
    /// across pods (we have no cancel endpoint, and the token is the only
    /// mechanism `drain_source` checks). Entries are removed on `finish`.
    local_cancels: Arc<Mutex<HashMap<JobId, CancellationToken>>>,
    ttl: Duration,
}

impl BackfillJobs {
    pub fn new(redis: ConnectionManager, ttl: Duration) -> Self {
        Self {
            redis,
            local_cancels: Arc::new(Mutex::new(HashMap::new())),
            ttl,
        }
    }

    /// Allocate a new job slot and return the handle the spawning code
    /// needs to drive and observe it. Writes the initial hash + TTL before
    /// returning so a subsequent status poll can find it.
    pub async fn start(&self, entity: &str) -> anyhow::Result<JobHandle> {
        let id = JobId::new();
        let key = job_key(&id);
        let started_at = Utc::now();

        let mut conn = self.redis.clone();
        let _: () = redis::pipe()
            .atomic()
            .hset(&key, "status", JobStatus::Running.as_str())
            .hset(&key, "enqueued", 0i64)
            .hset(&key, "started_at", started_at.to_rfc3339())
            .hset(&key, "entity", entity)
            .expire(&key, self.ttl.as_secs() as i64)
            .query_async(&mut conn)
            .await?;

        let cancel = CancellationToken::new();
        self.local_cancels
            .lock()
            .unwrap()
            .insert(id.clone(), cancel.clone());

        Ok(JobHandle {
            id,
            progress: Arc::new(JobProgress::redis(self.redis.clone(), key)),
            cancel,
        })
    }

    /// Record the orchestrator's terminal result. Treats an `Ok` after the
    /// token fired as `Cancelled` so a clean `select!` exit still surfaces
    /// to the status endpoint. Drops the local cancellation entry — a
    /// finished job can no longer be cancelled.
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

        let (status, error) = match result {
            Ok(_) if was_cancelled => (JobStatus::Cancelled, None),
            Ok(_) => (JobStatus::Completed, None),
            Err(e) => (JobStatus::Failed, Some(format!("{e}"))),
        };

        let key = job_key(id);
        let finished_at = Utc::now().to_rfc3339();
        let mut conn = self.redis.clone();
        let mut pipe = redis::pipe();
        pipe.atomic()
            .hset(&key, "status", status.as_str())
            .hset(&key, "finished_at", finished_at)
            .expire(&key, self.ttl.as_secs() as i64);
        if let Some(e) = error {
            pipe.hset(&key, "error", e);
        }
        let _: () = pipe.query_async(&mut conn).await?;

        Ok(())
    }

    /// Read the current state of a job from Redis. `Ok(None)` when the key
    /// has expired or never existed.
    pub async fn snapshot(&self, id: &JobId) -> anyhow::Result<Option<JobSnapshot>> {
        let key = job_key(id);
        let mut conn = self.redis.clone();
        let map: HashMap<String, String> = conn.hgetall(&key).await?;
        if map.is_empty() {
            return Ok(None);
        }

        let status = map
            .get("status")
            .and_then(|s| JobStatus::from_str(s))
            .unwrap_or(JobStatus::Running);
        let enqueued: usize = map
            .get("enqueued")
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let started_at = map
            .get("started_at")
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(Utc::now);
        let finished_at = map
            .get("finished_at")
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&Utc));
        let error = map.get("error").cloned();

        Ok(Some(JobSnapshot {
            job_id: id.clone(),
            status,
            enqueued,
            started_at,
            finished_at,
            error,
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

#[cfg(test)]
mod test;
