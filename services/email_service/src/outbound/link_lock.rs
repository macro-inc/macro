//! Connecting an inbox writes its `email_links` row, which a CRM contact
//! population share-locks for its whole transaction and the mailbox workers
//! lock exclusively. These writes give up after 5 s (SQLSTATE 55P03) with a
//! retryable error instead of holding a pooled connection for as long.

use email::domain::mailbox::DatabaseFailure;
use sqlx::{PgPool, Postgres, Transaction};

/// Opens a transaction that gives up on a lock it cannot get within 5 s.
pub(crate) async fn begin(pool: &PgPool) -> Result<Transaction<'static, Postgres>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query!("SET LOCAL lock_timeout = '5s'")
        .execute(&mut *tx)
        .await?;
    Ok(tx)
}

/// Whether a statement gave up waiting for a lock.
pub(crate) fn is_lock_timeout(error: &sqlx::Error) -> bool {
    DatabaseFailure::from(error).is_lock_timeout()
}

/// Whether a lock timeout is anywhere in the error's chain.
pub(crate) fn caused_by_lock_timeout(error: &anyhow::Error) -> bool {
    error
        .chain()
        .filter_map(|cause| cause.downcast_ref::<sqlx::Error>())
        .any(is_lock_timeout)
}
