use super::*;

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
