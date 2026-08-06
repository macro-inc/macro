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
fn lease_loss_is_retryable_and_terminal_completion_is_idempotent() {
    let job_id = Uuid::new_v4();

    assert!(completion_result(job_id, BackfillCompletion::Completed).is_ok());
    assert!(completion_result(job_id, BackfillCompletion::AlreadyTerminal).is_ok());
    assert!(matches!(
        completion_result(job_id, BackfillCompletion::LeaseLost),
        Err(ProcessingError::Retryable(DetailedError {
            reason: FailureReason::EmailBackfillInitBusy,
            ..
        }))
    ));
    assert!(matches!(
        completion_result(job_id, BackfillCompletion::NotFound),
        Err(ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::BackfillJobNotFound,
            ..
        }))
    ));
}

#[tokio::test]
async fn terminal_completion_invalidates_cached_job() {
    let caches = PubSubCaches::new();
    let job_id = Uuid::new_v4();

    caches
        .backfill_jobs
        .get_or_load(job_id, || async {
            Ok::<_, Infallible>(backfill_job(job_id, BackfillJobStatus::InProgress))
        })
        .await
        .unwrap();
    invalidate_job_after_completion(&caches, job_id, BackfillCompletion::Completed);
    let reloaded = caches
        .backfill_jobs
        .get_or_load(job_id, || async {
            Ok::<_, Infallible>(backfill_job(job_id, BackfillJobStatus::Complete))
        })
        .await
        .unwrap();

    assert_eq!(reloaded.status, BackfillJobStatus::Complete);
}
