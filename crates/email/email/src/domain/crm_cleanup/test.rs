use super::*;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

mod candidate;
mod events;
mod fakes;
mod listing;
mod start;
use fakes::*;

fn retryable(
    result: Result<(), ProcessingError>,
    reason: FailureReason,
    context: &str,
) -> DetailedError {
    let Err(ProcessingError::Retryable(detail)) = result else {
        panic!("expected retryable failure");
    };
    assert_eq!(detail.reason, reason);
    assert_eq!(detail.source.to_string(), context);
    detail
}

#[tokio::test]
async fn malformed_input_retains_the_original_error_for_best_effort_deletion() {
    let (service, fake) = setup();
    let CrmCleanupDisposition::InvalidDelete(error) = service
        .process(Err(
            anyhow::Error::new(Fault("decode")).context("decode context")
        ))
        .await
    else {
        panic!("invalid input must select best-effort deletion");
    };
    assert_eq!(error.to_string(), "decode context");
    assert_eq!(error.downcast_ref::<Fault>().unwrap().0, "decode");
    assert!(fake.calls().is_empty());
}

#[tokio::test]
async fn retryable_operation_retains_delivery_and_terminal_operation_deletes() {
    let (service, fake) = setup();
    fake.0.lock().unwrap().fault = Some(("snapshot", 1));
    assert!(matches!(
        service.process(Ok(CrmCleanupOperation::StartJob)).await,
        CrmCleanupDisposition::LeaveForRedelivery
    ));
    assert_eq!(fake.calls(), [Call::Snapshot]);

    let (service, fake) = setup();
    {
        let mut s = fake.0.lock().unwrap();
        s.created.clear();
        s.active = None;
    }
    assert!(matches!(
        service.process(Ok(CrmCleanupOperation::StartJob)).await,
        CrmCleanupDisposition::Delete
    ));
    assert_eq!(
        fake.calls(),
        [Call::Snapshot, Call::Create(3, 300), Call::Active]
    );
}

#[tokio::test]
async fn only_terminal_listers_attempt_to_fail_the_job_including_a_failed_status_write() {
    for fails in [false, true] {
        let (service, fake) = setup();
        {
            let mut s = fake.0.lock().unwrap();
            s.job = None;
            if fails {
                s.fault = Some(("status", 1));
            }
        }
        assert!(matches!(
            service
                .process(Ok(CrmCleanupOperation::ListCandidates {
                    job_id: JOB,
                    last_id: 0
                }))
                .await,
            CrmCleanupDisposition::Delete
        ));
        assert_eq!(
            fake.calls(),
            [
                Call::Job(JOB),
                Call::Status(JOB, CrmCleanupJobStatus::Failed)
            ]
        );
    }
}
