//! Bounded retries for complete database transactions aborted by PostgreSQL.

use std::{error::Error, future::Future, time::Duration};

#[cfg(test)]
mod test;

/// Whether PostgreSQL positively identified a transaction it aborted for a
/// deadlock or serialization failure. Connection and ambiguous commit failures
/// are deliberately excluded, since their effects may already have committed.
pub fn is_transaction_conflict(mut error: &(dyn Error + 'static)) -> bool {
    loop {
        if let Some(sqlx::Error::Database(database)) = error.downcast_ref::<sqlx::Error>() {
            return matches!(database.code().as_deref(), Some("40P01" | "40001"));
        }
        if let Some(database) = error.downcast_ref::<sqlx::postgres::PgDatabaseError>() {
            return matches!(database.code(), "40P01" | "40001");
        }
        // ReportAsError deliberately has no std::error::Error source chain.
        // Canonical sharing carries SQLx errors inside these report contexts.
        if let Some(wrapper) = error.downcast_ref::<rootcause::compat::ReportAsError>() {
            return wrapper.0.iter_reports().any(|context| {
                context
                    .downcast_current_context::<sqlx::Error>()
                    .is_some_and(|error| is_transaction_conflict(error))
                    || context
                        .downcast_current_context::<sqlx::postgres::PgDatabaseError>()
                        .is_some_and(|error| is_transaction_conflict(error))
                    || context
                        .downcast_current_context::<anyhow::Error>()
                        .is_some_and(|error| is_transaction_conflict(error.as_ref()))
                    || context
                        .downcast_current_context::<rootcause::compat::ReportAsError>()
                        .is_some_and(|error| is_transaction_conflict(error))
                    || context
                        .current_context_error_source()
                        .is_some_and(is_transaction_conflict)
            });
        }
        match error.source() {
            Some(source) => error = source,
            None => return false,
        }
    }
}

/// Converts a report for an adapter whose error type is `sqlx::Error`, keeping a
/// PostgreSQL deadlock or serialization abort inside it visible to
/// [`is_transaction_conflict`]. Other failures keep their message as before.
pub fn report_into_sqlx_error<C: ?Sized>(report: rootcause::Report<C>) -> sqlx::Error {
    let message = report.to_string();
    let error = rootcause::compat::ReportAsError::from(report.into_dynamic());
    if is_transaction_conflict(&error) {
        sqlx::Error::AnyDriverError(Box::new(error))
    } else {
        sqlx::Error::Protocol(message)
    }
}

/// Run a transaction at most four times, retrying only confirmed conflicts.
///
/// Each invocation must contain a complete transaction, from begin through
/// commit, or a single autocommit statement. Keep external side effects outside;
/// a failed attempt is rolled back before the next invocation. The classifier
/// lets adapters retain their existing typed errors and error context.
pub async fn on_conflict<T, E, F, Fut>(
    mut transaction: F,
    is_conflict: impl Fn(&E) -> bool,
) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, E>>,
{
    for attempt in 0..4 {
        match transaction().await {
            Err(error) if attempt < 3 && is_conflict(&error) => {
                tracing::warn!(
                    attempt = attempt + 1,
                    "retrying aborted database transaction"
                );
                tokio::time::sleep(Duration::from_millis(25 << attempt)).await;
            }
            result => return result,
        }
    }
    unreachable!("the final attempt returns its result")
}
