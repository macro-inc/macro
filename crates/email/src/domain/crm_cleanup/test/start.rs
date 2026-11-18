use super::*;
use chrono::TimeDelta;

#[tokio::test]
async fn empty_snapshot_does_not_create_or_read_a_job() {
    let (service, fake) = setup();
    fake.0.lock().unwrap().snapshot = None;
    assert!(matches!(
        service.process(Ok(CrmCleanupOperation::StartJob)).await,
        CrmCleanupDisposition::Delete
    ));
    assert_eq!(fake.calls(), [Call::Snapshot]);
}

#[tokio::test]
async fn new_job_publishes_before_marking_progress_without_reading_clock() {
    let (service, fake) = setup();
    super::super::start_job::start_job(&service).await.unwrap();
    assert_eq!(
        fake.calls(),
        [
            Call::Snapshot,
            Call::Create(3, 300),
            Call::Send(CrmCleanupOperation::ListCandidates {
                job_id: JOB,
                last_id: 0
            }),
            Call::Status(JOB, CrmCleanupJobStatus::InProgress)
        ]
    );
}

#[tokio::test]
async fn only_a_recent_init_job_is_resumed_after_a_create_conflict() {
    for status in [
        CrmCleanupJobStatus::Init,
        CrmCleanupJobStatus::InProgress,
        CrmCleanupJobStatus::Complete,
        CrmCleanupJobStatus::Failed,
    ] {
        let (service, fake) = setup();
        {
            let mut s = fake.0.lock().unwrap();
            s.created.clear();
            s.active = Some(job(status));
        }
        super::super::start_job::start_job(&service).await.unwrap();
        let mut expected = vec![
            Call::Snapshot,
            Call::Create(3, 300),
            Call::Active,
            Call::Now,
        ];
        if status == CrmCleanupJobStatus::Init {
            expected.extend([
                Call::Send(CrmCleanupOperation::ListCandidates {
                    job_id: JOB,
                    last_id: 0,
                }),
                Call::Status(JOB, CrmCleanupJobStatus::InProgress),
            ]);
        }
        assert_eq!(fake.calls(), expected);
    }
}

#[tokio::test]
async fn twelve_hour_staleness_is_strict_and_replacement_uses_frozen_snapshot() {
    for delta in [-1, 0, 1] {
        let (service, fake) = setup();
        let fresh = uuid::Uuid::from_u128(42);
        {
            let mut s = fake.0.lock().unwrap();
            let mut active = job(CrmCleanupJobStatus::InProgress);
            active.updated_at = now() - TimeDelta::hours(12) - TimeDelta::nanoseconds(delta);
            s.active = Some(active);
            let mut replacement = job(CrmCleanupJobStatus::Init);
            replacement.id = fresh;
            s.created = [None, Some(replacement)].into();
        }
        super::super::start_job::start_job(&service).await.unwrap();
        let mut expected = vec![
            Call::Snapshot,
            Call::Create(3, 300),
            Call::Active,
            Call::Now,
        ];
        if delta > 0 {
            expected.extend([
                Call::Status(JOB, CrmCleanupJobStatus::Failed),
                Call::Create(3, 300),
                Call::Send(CrmCleanupOperation::ListCandidates {
                    job_id: fresh,
                    last_id: 0,
                }),
                Call::Status(fresh, CrmCleanupJobStatus::InProgress),
            ]);
        }
        assert_eq!(fake.calls(), expected);
    }
}

#[tokio::test]
async fn a_concurrent_replacement_winner_stops_publication_after_failing_old_job() {
    let (service, fake) = setup();
    {
        let mut s = fake.0.lock().unwrap();
        s.created.clear();
        s.active.as_mut().unwrap().updated_at = now() - TimeDelta::hours(13);
    }
    super::super::start_job::start_job(&service).await.unwrap();
    assert_eq!(
        fake.calls(),
        [
            Call::Snapshot,
            Call::Create(3, 300),
            Call::Active,
            Call::Now,
            Call::Status(JOB, CrmCleanupJobStatus::Failed),
            Call::Create(3, 300)
        ]
    );
}

#[tokio::test]
async fn disappeared_active_job_is_the_existing_nonretryable_invalid_data_error() {
    let (service, fake) = setup();
    {
        let mut s = fake.0.lock().unwrap();
        s.created.clear();
        s.active = None;
    }
    let Err(ProcessingError::NonRetryable(e)) = super::super::start_job::start_job(&service).await
    else {
        panic!("missing active job must be terminal")
    };
    assert_eq!(e.reason, FailureReason::InvalidData);
    assert_eq!(
        e.source.to_string(),
        "Active crm cleanup job disappeared between create and fetch"
    );
}

#[tokio::test]
async fn kickoff_failures_keep_their_exact_context_and_retry_classification() {
    for (name, nth, context, reason) in [
        (
            "snapshot",
            1,
            "Failed to snapshot crm cleanup candidates",
            FailureReason::DatabaseQueryFailed,
        ),
        (
            "create",
            1,
            "Failed to create crm cleanup job",
            FailureReason::DatabaseQueryFailed,
        ),
        (
            "active",
            1,
            "Failed to fetch active crm cleanup job",
            FailureReason::DatabaseQueryFailed,
        ),
        (
            "status",
            1,
            "Failed to fail stale crm cleanup job",
            FailureReason::DatabaseQueryFailed,
        ),
        (
            "create",
            2,
            "Failed to create replacement crm cleanup job",
            FailureReason::DatabaseQueryFailed,
        ),
        (
            "send",
            1,
            "Failed to enqueue first ListCandidates message",
            FailureReason::SqsEnqueueFailed,
        ),
    ] {
        let (service, fake) = setup();
        {
            let mut s = fake.0.lock().unwrap();
            s.created = [None, Some(job(CrmCleanupJobStatus::Init))].into();
            s.active.as_mut().unwrap().updated_at = now() - TimeDelta::hours(13);
            s.fault = Some((name, nth));
        }
        let detail = retryable(
            super::super::start_job::start_job(&service).await,
            reason,
            context,
        );
        assert_eq!(detail.source.downcast_ref::<Fault>().unwrap().0, name);
        assert_eq!(fake.0.lock().unwrap().counts.get(name), Some(&nth));
        assert!(!matches!(
            fake.calls().last(),
            Some(Call::Status(_, CrmCleanupJobStatus::InProgress))
        ));
    }
}

#[tokio::test]
async fn a_progress_write_failure_is_best_effort_after_the_send() {
    let (service, fake) = setup();
    fake.0.lock().unwrap().fault = Some(("status", 1));
    assert!(matches!(
        service.process(Ok(CrmCleanupOperation::StartJob)).await,
        CrmCleanupDisposition::Delete
    ));
    assert_eq!(
        fake.calls(),
        [
            Call::Snapshot,
            Call::Create(3, 300),
            Call::Send(CrmCleanupOperation::ListCandidates {
                job_id: JOB,
                last_id: 0
            }),
            Call::Status(JOB, CrmCleanupJobStatus::InProgress)
        ]
    );
}
