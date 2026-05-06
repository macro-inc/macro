//! Integration-ish tests for the Redis-backed backfill registry.
//!
//! These exercise real Redis (matching the DCS test pattern at
//! `document_cognition_service/src/api/context/test.rs:383`). Each test
//! generates fresh `JobId`s (UUIDs) so parallel test runs don't collide on
//! the shared Redis at `redis://127.0.0.1:6379/`. Skipped if Redis is
//! unreachable rather than failing — this keeps `cargo test` working in
//! environments without a running Redis (e.g. CI without docker-compose
//! up).

use std::time::Duration;

use super::*;

/// Try to connect to local Redis. Returns `None` if Redis isn't running so
/// the test can short-circuit instead of failing.
async fn try_jobs() -> Option<BackfillJobs> {
    let client = redis::Client::open("redis://127.0.0.1:6379/").ok()?;
    let conn = client.get_connection_manager().await.ok()?;
    Some(BackfillJobs::new(conn, Duration::from_secs(60)))
}

#[tokio::test]
async fn snapshot_reflects_progress_updates() {
    let Some(jobs) = try_jobs().await else {
        eprintln!("skipping: redis not reachable at localhost:6379");
        return;
    };
    let handle = jobs.start("calls").await.expect("start");

    handle.progress.add(7).await;
    handle.progress.add(3).await;

    let snap = jobs.snapshot(&handle.id).await.expect("snapshot").unwrap();
    assert_eq!(snap.enqueued, 10);
    assert_eq!(snap.status, JobStatus::Running);
    assert!(snap.finished_at.is_none());
}

#[tokio::test]
async fn finish_ok_after_cancel_marks_cancelled() {
    let Some(jobs) = try_jobs().await else {
        eprintln!("skipping: redis not reachable at localhost:6379");
        return;
    };
    let handle = jobs.start("chats").await.expect("start");
    handle.cancel.cancel();
    jobs.finish(&handle.id, Ok(BackfillReceipt { enqueued: 0 }))
        .await
        .expect("finish");

    let snap = jobs.snapshot(&handle.id).await.expect("snapshot").unwrap();
    assert_eq!(snap.status, JobStatus::Cancelled);
    assert!(snap.finished_at.is_some());
}

#[tokio::test]
async fn finish_err_records_failure_message() {
    let Some(jobs) = try_jobs().await else {
        eprintln!("skipping: redis not reachable at localhost:6379");
        return;
    };
    let handle = jobs.start("documents").await.expect("start");
    jobs.finish(
        &handle.id,
        Err(BackfillError::Source(anyhow::anyhow!("boom"))),
    )
    .await
    .expect("finish");

    let snap = jobs.snapshot(&handle.id).await.expect("snapshot").unwrap();
    assert_eq!(snap.status, JobStatus::Failed);
    assert!(
        snap.error
            .as_deref()
            .is_some_and(|e| e.contains("failed reading backfill source"))
    );
}

#[tokio::test]
async fn cancel_all_local_fires_every_local_token() {
    let Some(jobs) = try_jobs().await else {
        eprintln!("skipping: redis not reachable at localhost:6379");
        return;
    };
    let a = jobs.start("calls").await.expect("a");
    let b = jobs.start("chats").await.expect("b");

    jobs.cancel_all_local();

    assert!(a.cancel.is_cancelled());
    assert!(b.cancel.is_cancelled());
}

#[tokio::test]
async fn snapshot_returns_none_for_unknown_id() {
    let Some(jobs) = try_jobs().await else {
        eprintln!("skipping: redis not reachable at localhost:6379");
        return;
    };
    assert!(
        jobs.snapshot(&JobId::new())
            .await
            .expect("snapshot")
            .is_none()
    );
}

#[tokio::test]
async fn finish_drops_local_cancel_entry() {
    // After finish() the local cancel map shouldn't keep the token —
    // otherwise long-lived processes accumulate handles for finished jobs
    // alongside the Redis-side TTL'd state.
    let Some(jobs) = try_jobs().await else {
        eprintln!("skipping: redis not reachable at localhost:6379");
        return;
    };
    let handle = jobs.start("emails").await.expect("start");
    let id = handle.id.clone();
    jobs.finish(&id, Ok(BackfillReceipt { enqueued: 0 }))
        .await
        .expect("finish");

    // Calling cancel_all_local now is a no-op for this id; verify the map
    // doesn't still contain it.
    assert!(!jobs.local_cancels.lock().unwrap().contains_key(&id));
}
