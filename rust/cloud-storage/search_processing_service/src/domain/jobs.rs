//! In-memory registry of long-running backfill jobs.
//!
//! Backfills can take many minutes for prod-scale entities — well past the
//! ALB idle timeout — so the HTTP handler kicks the orchestrator onto a
//! background tokio task and returns a [`JobId`] right away. Clients poll
//! [`BackfillJobs::snapshot`] for progress; the orchestrator updates the
//! shared [`JobProgress`] as each page lands. On shutdown,
//! [`BackfillJobs::cancel_all`] fires every job's [`CancellationToken`] so
//! drains stop between pages instead of being killed mid-publish.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

use chrono::{DateTime, Utc};
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

/// Live row counter the orchestrator increments per page so the status
/// endpoint can report progress while the backfill is still running.
#[derive(Debug, Default)]
pub struct JobProgress {
    enqueued: AtomicUsize,
}

impl JobProgress {
    pub fn add(&self, n: usize) {
        self.enqueued.fetch_add(n, Ordering::Relaxed);
    }

    pub fn enqueued(&self) -> usize {
        self.enqueued.load(Ordering::Relaxed)
    }
}

/// Terminal state of a tracked job. `Running` is the only non-terminal
/// variant; the others are written exactly once when the worker future
/// resolves or is cancelled.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum JobStatus {
    Running,
    Completed,
    Failed { error: String },
    Cancelled,
}

#[derive(Debug, Serialize)]
pub struct JobSnapshot {
    pub job_id: JobId,
    #[serde(flatten)]
    pub status: JobStatus,
    pub enqueued: usize,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
}

/// Bag of state the spawning code needs after [`BackfillJobs::start`]: the
/// id to hand back over HTTP, the progress counter to thread into the
/// orchestrator, and the token to wire to a `select!` for shutdown.
pub struct JobHandle {
    pub id: JobId,
    pub progress: Arc<JobProgress>,
    pub cancel: CancellationToken,
}

struct JobRecord {
    progress: Arc<JobProgress>,
    cancel: CancellationToken,
    status: JobStatus,
    started_at: DateTime<Utc>,
    finished_at: Option<DateTime<Utc>>,
}

/// Async-shareable registry of in-flight and finished backfill jobs. Cheap
/// to clone — backed by an `Arc<Mutex<HashMap>>` whose lock is never held
/// across awaits.
#[derive(Clone, Default)]
pub struct BackfillJobs {
    inner: Arc<Mutex<HashMap<JobId, JobRecord>>>,
}

impl BackfillJobs {
    pub fn new() -> Self {
        Self::default()
    }

    /// Allocate a new job slot and return the handle the spawning code
    /// needs to drive and observe it.
    pub fn start(&self) -> JobHandle {
        let id = JobId::new();
        let progress = Arc::new(JobProgress::default());
        let cancel = CancellationToken::new();
        let record = JobRecord {
            progress: progress.clone(),
            cancel: cancel.clone(),
            status: JobStatus::Running,
            started_at: Utc::now(),
            finished_at: None,
        };
        self.inner.lock().unwrap().insert(id.clone(), record);
        JobHandle {
            id,
            progress,
            cancel,
        }
    }

    /// Record the orchestrator's terminal result. Treats an `Ok` after the
    /// token fired as `Cancelled` so a clean `select!` exit still surfaces
    /// to the status endpoint.
    pub fn finish(&self, id: &JobId, result: Result<BackfillReceipt, BackfillError>) {
        let mut guard = self.inner.lock().unwrap();
        let Some(record) = guard.get_mut(id) else {
            return;
        };
        record.finished_at = Some(Utc::now());
        record.status = match result {
            Ok(_) if record.cancel.is_cancelled() => JobStatus::Cancelled,
            Ok(_) => JobStatus::Completed,
            Err(e) => JobStatus::Failed {
                error: format!("{e}"),
            },
        };
    }

    pub fn snapshot(&self, id: &JobId) -> Option<JobSnapshot> {
        let guard = self.inner.lock().unwrap();
        let record = guard.get(id)?;
        Some(JobSnapshot {
            job_id: id.clone(),
            status: record.status.clone(),
            enqueued: record.progress.enqueued(),
            started_at: record.started_at,
            finished_at: record.finished_at,
        })
    }

    /// Fire every tracked job's cancellation token. Used on graceful
    /// shutdown so drains stop between pages instead of being killed
    /// mid-publish when the runtime exits.
    pub fn cancel_all(&self) {
        let guard = self.inner.lock().unwrap();
        for record in guard.values() {
            record.cancel.cancel();
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn snapshot_reflects_progress_updates() {
        let jobs = BackfillJobs::new();
        let handle = jobs.start();
        handle.progress.add(7);
        handle.progress.add(3);

        let snap = jobs.snapshot(&handle.id).unwrap();
        assert_eq!(snap.enqueued, 10);
        assert!(matches!(snap.status, JobStatus::Running));
    }

    #[test]
    fn finish_ok_after_cancel_marks_cancelled() {
        let jobs = BackfillJobs::new();
        let handle = jobs.start();
        handle.cancel.cancel();
        jobs.finish(&handle.id, Ok(BackfillReceipt { enqueued: 0 }));

        let snap = jobs.snapshot(&handle.id).unwrap();
        assert!(matches!(snap.status, JobStatus::Cancelled));
        assert!(snap.finished_at.is_some());
    }

    #[test]
    fn finish_err_records_failure_message() {
        let jobs = BackfillJobs::new();
        let handle = jobs.start();
        jobs.finish(
            &handle.id,
            Err(BackfillError::Source(anyhow::anyhow!("boom"))),
        );

        let snap = jobs.snapshot(&handle.id).unwrap();
        match snap.status {
            JobStatus::Failed { error } => {
                assert!(error.contains("failed reading backfill source"))
            }
            other => panic!("expected Failed, got {other:?}"),
        }
    }

    #[test]
    fn cancel_all_fires_every_token() {
        let jobs = BackfillJobs::new();
        let a = jobs.start();
        let b = jobs.start();

        jobs.cancel_all();

        assert!(a.cancel.is_cancelled());
        assert!(b.cancel.is_cancelled());
    }

    #[test]
    fn snapshot_returns_none_for_unknown_id() {
        let jobs = BackfillJobs::new();
        assert!(jobs.snapshot(&JobId::new()).is_none());
    }
}
