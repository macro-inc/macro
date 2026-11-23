use futures_core::future::BoxFuture;
use sqlx_core::database::Database;
use std::borrow::Cow;

use crate::error::Error;
use crate::executor::Executor;

use crate::{PgConnection, Postgres};

pub(crate) use sqlx_core::transaction::*;

/// Implementation of [`TransactionManager`] for PostgreSQL.
pub struct PgTransactionManager;

impl TransactionManager for PgTransactionManager {
    type Database = Postgres;

    fn begin<'conn>(
        conn: &'conn mut PgConnection,
        statement: Option<Cow<'static, str>>,
    ) -> BoxFuture<'conn, Result<(), Error>> {
        Box::pin(async move {
            let depth = conn.inner.transaction_depth;
            let statement = match statement {
                // custom `BEGIN` statements are not allowed if we're already in
                // a transaction (we need to issue a `SAVEPOINT` instead)
                Some(_) if depth > 0 => return Err(Error::InvalidSavePointStatement),
                Some(statement) => statement,
                None => begin_ansi_transaction_sql(depth),
            };

            let rollback = Rollback::new(conn);
            rollback.conn.queue_simple_query(&statement)?;
            // Claim the depth before the round trip, not after. `start_rollback` -- which both
            // this guard and `Transaction`'s own drop guard call -- is a no-op while the depth is
            // zero, so a future cancelled during the await below would otherwise leave the server
            // in a transaction with nothing queued to end it. `Pool` then hands that connection
            // to the next borrower, whose statements silently run inside it. Unwound just below
            // if the BEGIN did not take.
            rollback.conn.inner.transaction_depth += 1;
            if let Err(error) = rollback.conn.wait_until_ready().await {
                // Macro: the server refused the SAVEPOINT (say, in an aborted transaction),
                // so there is none to roll back to. Left armed, the guard would queue
                // `ROLLBACK TO SAVEPOINT` for it, and the caller's next statement would
                // fail with "savepoint does not exist". A refused top-level BEGIN keeps
                // the guard: a custom statement may have opened the transaction first.
                if depth > 0 && matches!(error, Error::Database(_)) {
                    rollback.conn.inner.transaction_depth -= 1;
                    rollback.defuse();
                }
                return Err(error);
            }
            if !rollback.conn.in_transaction() {
                rollback.conn.inner.transaction_depth -= 1;
                return Err(Error::BeginFailed);
            }
            rollback.defuse();

            Ok(())
        })
    }

    fn commit(conn: &mut PgConnection) -> BoxFuture<'_, Result<(), Error>> {
        Box::pin(async move {
            if conn.inner.transaction_depth > 0 {
                conn.execute(&*commit_ansi_transaction_sql(conn.inner.transaction_depth))
                    .await?;

                conn.inner.transaction_depth -= 1;
            }

            Ok(())
        })
    }

    fn rollback(conn: &mut PgConnection) -> BoxFuture<'_, Result<(), Error>> {
        Box::pin(async move {
            if conn.inner.transaction_depth > 0 {
                conn.execute(&*rollback_ansi_transaction_sql(
                    conn.inner.transaction_depth,
                ))
                .await?;

                conn.inner.transaction_depth -= 1;
            }

            Ok(())
        })
    }

    fn start_rollback(conn: &mut PgConnection) {
        if conn.inner.transaction_depth > 0 {
            conn.queue_simple_query(&rollback_ansi_transaction_sql(conn.inner.transaction_depth))
                .expect("BUG: Rollback query somehow too large for protocol");

            conn.inner.transaction_depth -= 1;
        }
    }

    fn get_transaction_depth(conn: &<Self::Database as Database>::Connection) -> usize {
        conn.inner.transaction_depth
    }
}

struct Rollback<'c> {
    conn: &'c mut PgConnection,
    defuse: bool,
}

impl Drop for Rollback<'_> {
    fn drop(&mut self) {
        if !self.defuse {
            PgTransactionManager::start_rollback(self.conn)
        }
    }
}

impl<'c> Rollback<'c> {
    fn new(conn: &'c mut PgConnection) -> Self {
        Self {
            conn,
            defuse: false,
        }
    }
    fn defuse(mut self) {
        self.defuse = true;
    }
}
