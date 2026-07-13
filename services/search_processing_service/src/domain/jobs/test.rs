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
    jobs.finish(&id, Ok(BackfillReceipt { enqueued: 0 }))
        .await
        .expect("finish");

    assert!(!jobs.local_cancels.lock().unwrap().contains_key(&id));
}
