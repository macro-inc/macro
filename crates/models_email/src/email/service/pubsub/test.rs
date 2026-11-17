use super::*;

#[test]
fn a_processing_error_displays_its_reason_and_whole_cause_chain() {
    let detailed = || DetailedError {
        reason: FailureReason::DatabaseQueryFailed,
        source: anyhow::anyhow!("connection reset").context("Failed to populate CRM contact"),
    };
    assert_eq!(
        ProcessingError::Retryable(detailed()).to_string(),
        "Retryable error occurred: DatabaseQueryFailed: Failed to populate CRM contact: connection reset"
    );
    assert_eq!(
        ProcessingError::NonRetryable(detailed()).to_string(),
        "Non-retryable error occurred: DatabaseQueryFailed: Failed to populate CRM contact: connection reset"
    );
}

#[test]
fn a_processing_error_wrapped_in_context_names_its_cause_once() {
    let wrapped = anyhow::Error::new(ProcessingError::Retryable(DetailedError {
        reason: FailureReason::GmailApiFailed,
        source: anyhow::anyhow!("status 500"),
    }))
    .context("backfill step");
    assert_eq!(
        format!("{wrapped:#}"),
        "backfill step: Retryable error occurred: GmailApiFailed: status 500"
    );
}
