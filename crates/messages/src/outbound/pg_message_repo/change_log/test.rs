use super::*;
use sqlx::error::{DatabaseError, ErrorKind};
use std::{borrow::Cow, error::Error as StdError, fmt};

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

#[test]
fn append_timeouts_are_retryable_and_preserve_the_database_cause() {
    for (code, message) in [
        ("55P03", "canceling statement due to lock timeout"),
        ("57014", "canceling statement due to statement timeout"),
    ] {
        let error = append_error(sqlx::Error::Database(Box::new(FakeDbError {
            code,
            message,
        })));

        assert_eq!(error.to_string(), "channel is busy; retry the request");
        let MessageError::Contended(report) = error else {
            panic!("append timeout must be retryable contention");
        };
        let preserved = report
            .downcast_current_context::<sqlx::Error>()
            .unwrap()
            .as_database_error()
            .unwrap();
        assert_eq!(preserved.code().as_deref(), Some(code));
        assert_eq!(preserved.message(), message);
    }
}

#[test]
fn user_requested_and_unrecognized_cancellations_keep_the_repository_error() {
    for (code, message) in [
        ("57014", "canceling statement due to user request"),
        ("57014", "localized statement timeout"),
        (
            "57014",
            "canceling statement due to statement timeout (detail)",
        ),
        ("40P01", "canceling statement due to statement timeout"),
    ] {
        let error = append_error(sqlx::Error::Database(Box::new(FakeDbError {
            code,
            message,
        })));

        let MessageError::Repository(report) = error else {
            panic!("only recognized append timeouts become contention");
        };
        let preserved = report
            .downcast_current_context::<sqlx::Error>()
            .unwrap()
            .as_database_error()
            .unwrap();
        assert_eq!(preserved.code().as_deref(), Some(code));
        assert_eq!(preserved.message(), message);
    }
}

#[test]
fn append_connection_failures_keep_the_repository_error() {
    let MessageError::Repository(report) = append_error(sqlx::Error::PoolTimedOut) else {
        panic!("pool acquisition failure is not an append deadline");
    };
    assert!(matches!(
        report.downcast_current_context::<sqlx::Error>(),
        Some(sqlx::Error::PoolTimedOut)
    ));
}
