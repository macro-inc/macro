//! Orders computer lifecycle observations across replicas without holding a
//! connection from the pool used by the presence and computer repositories.

use harness_id::HarnessId;
use sqlx::{PgPool, Postgres, Transaction};

#[cfg(test)]
mod test;

pub(super) struct PresenceGuard {
    transaction: Transaction<'static, Postgres>,
    harness: HarnessId,
}

impl PresenceGuard {
    pub(super) async fn lock(pool: &PgPool, harness: HarnessId) -> sqlx::Result<Self> {
        let mut transaction = pool.begin().await?;
        // Separate from the harness row lock taken by the inner repository.
        sqlx::query!(
            r#"
            SELECT 1 AS locked
            FROM pg_advisory_xact_lock(hashtextextended($1, 4973987001))
            "#,
            harness.to_string(),
        )
        .fetch_one(&mut *transaction)
        .await?;
        Ok(Self {
            transaction,
            harness,
        })
    }

    pub(super) async fn is_connected(&mut self) -> sqlx::Result<bool> {
        sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1 FROM harness_runtime_connection
                WHERE harness_id = $1 AND lease_expires_at > statement_timestamp()
            ) AS "connected!"
            "#,
            self.harness.as_uuid(),
        )
        .fetch_one(&mut *self.transaction)
        .await
    }
}
