//! Integration-ish tests for the DynamoDB-backed backfill registry.
//!
//! These exercise local DynamoDB (the `my-dynamodb` container started by
//! `just ensure_dynamodb`). Each test uses the same shared table; fresh
//! `JobId`s (UUIDs) keep parallel runs from clobbering each other. Tests
//! short-circuit if dynamodb-local isn't reachable so `cargo test` works
//! without the container running.

use std::time::Duration;

use aws_sdk_dynamodb::config::{BehaviorVersion, Credentials, Region};

use super::*;

const LOCAL_TABLE: &str = "search_processing_backfill_jobs_test";
const LOCAL_ENDPOINT: &str = "http://127.0.0.1:8000";

async fn try_jobs() -> Option<BackfillJobs> {
    // Build the DynamoDB client config directly via the SDK's own builder
    // — `aws-config` is wrapped by `macro_aws_config` workspace-wide, but
    // we need a per-client endpoint override that the wrapper doesn't
    // expose, so use the SDK builder here and skip `aws-config` entirely.
    let config = aws_sdk_dynamodb::config::Builder::new()
        .behavior_version(BehaviorVersion::latest())
        .region(Region::new("us-east-1"))
        .credentials_provider(Credentials::new("fake", "fake", None, None, "test"))
        .endpoint_url(LOCAL_ENDPOINT)
        .build();
    let client = aws_sdk_dynamodb::Client::from_conf(config);
    // Probe: list_tables fails fast if dynamodb-local isn't running.
    if client.list_tables().send().await.is_err() {
        return None;
    }
    let jobs = BackfillJobs::new(client, LOCAL_TABLE, Duration::from_secs(60));
    jobs.ensure_table().await.ok()?;
    Some(jobs)
}

#[tokio::test]
async fn snapshot_reflects_progress_updates() {
    let Some(jobs) = try_jobs().await else {
        eprintln!("skipping: dynamodb-local not reachable at {LOCAL_ENDPOINT}");
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
        eprintln!("skipping: dynamodb-local not reachable at {LOCAL_ENDPOINT}");
        return;
    };
    let handle = jobs.start("chats").await.expect("start");
    handle.cancel.cancel();
    jobs.finish(&handle.id, Ok(BackfillReceipt::default()))
        .await
        .expect("finish");

    let snap = jobs.snapshot(&handle.id).await.expect("snapshot").unwrap();
    assert_eq!(snap.status, JobStatus::Cancelled);
    assert!(snap.finished_at.is_some());
}

#[tokio::test]
async fn finish_err_records_failure_message() {
    let Some(jobs) = try_jobs().await else {
        eprintln!("skipping: dynamodb-local not reachable at {LOCAL_ENDPOINT}");
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
        eprintln!("skipping: dynamodb-local not reachable at {LOCAL_ENDPOINT}");
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
        eprintln!("skipping: dynamodb-local not reachable at {LOCAL_ENDPOINT}");
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
    let Some(jobs) = try_jobs().await else {
        eprintln!("skipping: dynamodb-local not reachable at {LOCAL_ENDPOINT}");
        return;
    };
    let handle = jobs.start("emails").await.expect("start");
    let id = handle.id.clone();
    jobs.finish(&id, Ok(BackfillReceipt::default()))
        .await
        .expect("finish");

    assert!(!jobs.local_cancels.lock().unwrap().contains_key(&id));
}

#[tokio::test]
async fn record_page_moves_the_cursor_and_adds_the_counts() {
    let Some(jobs) = try_jobs().await else {
        eprintln!("skipping: dynamodb-local not reachable at {LOCAL_ENDPOINT}");
        return;
    };
    let handle = jobs.start("email-attachment-status").await.expect("start");

    let before = jobs.snapshot(&handle.id).await.expect("snapshot").unwrap();
    assert_eq!(before.cursor, None);
    assert_eq!(before.updated, None);

    handle
        .progress
        .record_page(PageProgress {
            cursor: "doc-b",
            processed: 2,
            updated: 1,
            missing: 1,
            failed: 0,
        })
        .await;
    handle
        .progress
        .record_page(PageProgress {
            cursor: "doc-d",
            processed: 2,
            updated: 0,
            missing: 0,
            failed: 1,
        })
        .await;

    let snap = jobs.snapshot(&handle.id).await.expect("snapshot").unwrap();
    assert_eq!(snap.status, JobStatus::Running);
    assert_eq!(snap.enqueued, 4);
    assert_eq!(snap.cursor.as_deref(), Some("doc-d"));
    assert_eq!(snap.updated, Some(1));
    assert_eq!(snap.missing, Some(1));
    assert_eq!(snap.failed, Some(1));
}

#[tokio::test]
async fn finish_stopped_records_the_reason_and_the_cursor_to_resume_after() {
    let Some(jobs) = try_jobs().await else {
        eprintln!("skipping: dynamodb-local not reachable at {LOCAL_ENDPOINT}");
        return;
    };
    let handle = jobs.start("email-attachment-status").await.expect("start");
    jobs.finish(
        &handle.id,
        Err(BackfillError::Stopped {
            reason: "disk usage exceeded flood-stage watermark".to_owned(),
            cursor: Some("doc-b".to_owned()),
        }),
    )
    .await
    .expect("finish");

    let snap = jobs.snapshot(&handle.id).await.expect("snapshot").unwrap();
    assert_eq!(snap.status, JobStatus::Stopped);
    assert!(snap.finished_at.is_some());
    assert!(
        snap.error
            .as_deref()
            .is_some_and(|e| e.contains("flood-stage watermark")),
        "{:?}",
        snap.error
    );
    assert_eq!(snap.cursor.as_deref(), Some("doc-b"));
}

#[test]
fn a_job_that_left_messages_off_the_queue_is_not_completed() {
    let (status, error, _) = terminal_state(
        Ok(BackfillReceipt {
            enqueued: 30,
            not_queued: 2,
        }),
        false,
    );

    assert_eq!(status, JobStatus::Failed);
    assert_eq!(
        error.as_deref(),
        Some("the search event queue refused 2 of the backfill's messages")
    );
}

#[test]
fn a_cancelled_job_that_left_messages_off_the_queue_is_failed() {
    let (status, _, _) = terminal_state(
        Ok(BackfillReceipt {
            enqueued: 10,
            not_queued: 1,
        }),
        true,
    );

    assert_eq!(status, JobStatus::Failed);
}

#[test]
fn a_job_that_queued_everything_is_completed() {
    let (status, error, _) = terminal_state(
        Ok(BackfillReceipt {
            enqueued: 30,
            not_queued: 0,
        }),
        false,
    );

    assert_eq!((status, error), (JobStatus::Completed, None));
}

#[tokio::test]
async fn unqueued_messages_show_on_the_failed_job() {
    let Some(jobs) = try_jobs().await else {
        eprintln!("skipping: dynamodb-local not reachable at {LOCAL_ENDPOINT}");
        return;
    };
    let handle = jobs.start("documents").await.expect("start");
    handle.progress.add(5).await;
    handle.progress.add_not_queued(2).await;
    jobs.finish(
        &handle.id,
        Ok(BackfillReceipt {
            enqueued: 5,
            not_queued: 2,
        }),
    )
    .await
    .expect("finish");

    let snap = jobs.snapshot(&handle.id).await.expect("snapshot").unwrap();
    assert_eq!(snap.status, JobStatus::Failed);
    assert_eq!((snap.enqueued, snap.not_queued), (5, Some(2)));
}
