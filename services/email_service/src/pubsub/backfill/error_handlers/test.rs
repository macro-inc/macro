use super::*;
use chrono::Utc;
use models_email::service::backfill::{BackfillJob, BackfillJobStatus};
use std::convert::Infallible;

fn backfill_job(job_id: Uuid, status: BackfillJobStatus) -> BackfillJob {
    BackfillJob {
        id: job_id,
        link_id: Some(Uuid::new_v4()),
        fusionauth_user_id: "fusion-user".to_owned(),
        threads_requested_limit: None,
        total_threads: 10,
        status,
        threads_retrieved_count: 10,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

#[test]
fn detects_coordinator_failure_without_replaying_unclaimed_transition() {
    let permanent = anyhow::Error::new(GoogleCalendarBackfillRunError::Permanent(
        "invalid event".into(),
    ));
    assert_eq!(coordinator_reauth_edge(&permanent), Some(false));
}

#[test]
fn preserves_coordinator_reauth_notification_edge_through_context() {
    let reauth = anyhow::Error::new(GoogleCalendarBackfillRunError::ReauthRequired {
        message: "insufficient permissions".into(),
        link_reauth_transitioned: true,
    })
    .context("calendar worker failed");
    assert_eq!(coordinator_reauth_edge(&reauth), Some(true));
}

#[test]
fn prelease_failure_has_no_coordinator_marker() {
    assert_eq!(
        coordinator_reauth_edge(&anyhow::anyhow!("token refresh failed")),
        None
    );
}

#[tokio::test]
async fn terminal_failure_invalidates_cached_job() {
    let caches = PubSubCaches::new();
    let job_id = Uuid::new_v4();

    caches
        .backfill_jobs
        .get_or_load(job_id, || async {
            Ok::<_, Infallible>(backfill_job(job_id, BackfillJobStatus::InProgress))
        })
        .await
        .unwrap();
    invalidate_failed_job(&caches, job_id);
    let reloaded = caches
        .backfill_jobs
        .get_or_load(job_id, || async {
            Ok::<_, Infallible>(backfill_job(job_id, BackfillJobStatus::Failed))
        })
        .await
        .unwrap();

    assert_eq!(reloaded.status, BackfillJobStatus::Failed);
}
