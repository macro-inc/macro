use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

#[cfg(test)]
mod test;

/// SQLSTATE class 22, "Data Exception": the value itself cannot be represented
/// in its column. `22001` (string too long) is the one that wedged backfills —
/// a Gmail header longer than the `varchar(n)` it lands in — but every member
/// of the class shares the property that matters here: the same payload fails
/// identically on every attempt.
const DATA_EXCEPTION_CLASS: &str = "22";

/// `not_null_violation` — the row is missing a column the schema requires.
const NOT_NULL_VIOLATION: &str = "23502";

/// `check_violation` — the row fails a check constraint.
const CHECK_VIOLATION: &str = "23514";

/// Maps a database failure onto a retry policy.
///
/// The default is `Retryable`: transient connection drops, deadlocks, and
/// serialization failures all clear on redelivery. Errors that are a property
/// of the payload rather than of the moment are `NonRetryable` instead, so the
/// backfill error handlers count the thread as failed and let the job finish.
/// Left retryable, they burn 20 receives and land in the DLQ while the job's
/// completion counter sits one short forever.
///
/// `unique_violation` and `foreign_key_violation` are deliberately absent:
/// concurrent inserts of the same row make both genuinely transient.
pub(crate) fn map_db_error<C>(error: anyhow::Error, context: C) -> ProcessingError
where
    C: std::fmt::Display + Send + Sync + 'static,
{
    match deterministic_sqlstate(&error) {
        Some(sqlstate) => ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::InvalidData,
            source: error.context(format!("{context} (deterministic SQLSTATE {sqlstate})")),
        }),
        None => ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: error.context(context),
        }),
    }
}

/// Returns the SQLSTATE of the first database error in the chain that no
/// amount of retrying will get past.
fn deterministic_sqlstate(error: &anyhow::Error) -> Option<String> {
    error.chain().find_map(|cause| {
        let code = cause
            .downcast_ref::<sqlx::Error>()?
            .as_database_error()?
            .code()?;
        is_deterministic(&code).then(|| code.into_owned())
    })
}

fn is_deterministic(sqlstate: &str) -> bool {
    sqlstate.starts_with(DATA_EXCEPTION_CLASS)
        || matches!(sqlstate, NOT_NULL_VIOLATION | CHECK_VIOLATION)
}
