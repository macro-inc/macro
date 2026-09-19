use super::*;
use sqlx::error::{DatabaseError, ErrorKind};
use std::borrow::Cow;
use std::error::Error as StdError;
use std::fmt;

#[derive(Debug)]
struct FakeDbError {
    code: &'static str,
    message: &'static str,
}

impl fmt::Display for FakeDbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message)
    }
}

impl StdError for FakeDbError {}

impl DatabaseError for FakeDbError {
    fn message(&self) -> &str {
        self.message
    }

    fn code(&self) -> Option<Cow<'_, str>> {
        Some(Cow::Borrowed(self.code))
    }

    fn as_error(&self) -> &(dyn StdError + Send + Sync + 'static) {
        self
    }

    fn as_error_mut(&mut self) -> &mut (dyn StdError + Send + Sync + 'static) {
        self
    }

    fn into_error(self: Box<Self>) -> Box<dyn StdError + Send + Sync + 'static> {
        self
    }

    fn kind(&self) -> ErrorKind {
        ErrorKind::Other
    }
}

fn db_error(code: &'static str, message: &'static str) -> anyhow::Error {
    anyhow::Error::new(sqlx::Error::Database(Box::new(FakeDbError {
        code,
        message,
    })))
}

fn assert_non_retryable(error: anyhow::Error) -> DetailedError {
    match map_db_error(error, "insert failed") {
        ProcessingError::NonRetryable(detail) => detail,
        other => panic!("expected a non-retryable classification, got {other:?}"),
    }
}

fn assert_retryable(error: anyhow::Error) -> DetailedError {
    match map_db_error(error, "insert failed") {
        ProcessingError::Retryable(detail) => detail,
        other => panic!("expected a retryable classification, got {other:?}"),
    }
}

#[test]
fn string_data_right_truncation_is_terminal() {
    let detail = assert_non_retryable(db_error(
        "22001",
        "value too long for type character varying(320)",
    ));

    assert_eq!(detail.reason, FailureReason::InvalidData);
    let chain = format!("{:#}", detail.source);
    assert!(chain.contains("insert failed"));
    assert!(chain.contains("22001"));
}

#[test]
fn the_whole_data_exception_class_is_terminal() {
    for code in ["22003", "22007", "22021", "22P02"] {
        let detail = assert_non_retryable(db_error(code, "data exception"));
        assert_eq!(detail.reason, FailureReason::InvalidData);
    }
}

#[test]
fn not_null_and_check_violations_are_terminal() {
    for code in [NOT_NULL_VIOLATION, CHECK_VIOLATION] {
        assert_eq!(
            assert_non_retryable(db_error(code, "constraint violation")).reason,
            FailureReason::InvalidData
        );
    }
}

#[test]
fn conflicts_that_concurrency_can_cause_stay_retryable() {
    // A racing insert of the same row resolves on redelivery, so these must
    // not be treated as a property of the payload.
    for code in ["23505", "23503"] {
        assert_eq!(
            assert_retryable(db_error(code, "conflict")).reason,
            FailureReason::DatabaseQueryFailed
        );
    }
}

#[test]
fn transient_failures_stay_retryable() {
    for code in ["40001", "40P01", "53300", "57014", "08006"] {
        assert_eq!(
            assert_retryable(db_error(code, "transient")).reason,
            FailureReason::DatabaseQueryFailed
        );
    }
}

#[test]
fn non_database_errors_stay_retryable() {
    assert_eq!(
        assert_retryable(anyhow::anyhow!("pool timed out")).reason,
        FailureReason::DatabaseQueryFailed
    );
    assert_eq!(
        assert_retryable(anyhow::Error::new(sqlx::Error::PoolClosed)).reason,
        FailureReason::DatabaseQueryFailed
    );
}

#[test]
fn the_sqlstate_is_found_through_added_context() {
    // Production errors reach the mapper already wrapped by the db client's
    // own `.context(...)` calls; the classification must still see through.
    let wrapped = db_error("22001", "value too long")
        .context("Rollback also failed: none")
        .context("Failed to insert final message into database");

    assert_eq!(
        assert_non_retryable(wrapped).reason,
        FailureReason::InvalidData
    );
}
