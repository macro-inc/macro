//! Serialize shared Meta subscriptions through PostgreSQL across service instances.
use super::*;

const SUBSCRIPTION_WAIT: std::time::Duration = std::time::Duration::from_secs(60);

struct PgSubscriptionGuard {
    // Rollback-on-drop releases the transaction advisory lock on cancellation too.
    _transaction: sqlx::Transaction<'static, sqlx::Postgres>,
    _slot: tokio::sync::OwnedSemaphorePermit,
}
impl SubscriptionGuard for PgSubscriptionGuard {}

pub(super) fn key(c: &Connection) -> String {
    match (c.provider, c.business_account_id.as_ref()) {
        (Provider::Whatsapp, Some(business)) => {
            format!("meta-subscription:whatsapp:business:{}", business.as_str())
        }
        _ => format!(
            "meta-subscription:{}:account:{}",
            c.provider.as_str(),
            c.account_id.as_str()
        ),
    }
}
impl PgMessagingRepository {
    // Queue for bounded pool capacity before acquiring a connection. PostgreSQL
    // owns subscription serialization; blocked connects keep pool headroom for
    // the current owner's queries and release both resources on cancellation.
    pub(super) async fn connect_transaction(
        &self,
        c: &Connection,
    ) -> PortResult<(
        tokio::sync::OwnedSemaphorePermit,
        sqlx::Transaction<'static, sqlx::Postgres>,
    )> {
        tokio::time::timeout(SUBSCRIPTION_WAIT, async {
            let slot = self.subscription_slot().await?;
            let mut connection = self.pool.acquire().await.map_err(failure)?;
            // Cancellation must close the socket, not return it through a ping
            // queued behind the blocked advisory query after releasing our slot.
            connection.close_on_drop();
            let mut tx = sqlx::Transaction::begin(connection, None)
                .await
                .map_err(failure)?;
            sqlx::query!(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                key(c)
            )
            .execute(&mut *tx)
            .await
            .map_err(failure)?;
            Ok((slot, tx))
        })
        .await
        .map_err(|_| MessagingError::Unavailable)?
    }

    async fn subscription_slot(&self) -> PortResult<tokio::sync::OwnedSemaphorePermit> {
        tokio::time::timeout(
            SUBSCRIPTION_WAIT,
            self.subscription_slots.clone().acquire_owned(),
        )
        .await
        .map_err(|_| MessagingError::Unavailable)?
        .map_err(|_| MessagingError::Unavailable.into())
    }

    pub(super) async fn lock_subscription_impl(
        &self,
        c: &Connection,
    ) -> PortResult<Option<Box<dyn SubscriptionGuard>>> {
        let slot = self.subscription_slot().await?;
        let mut transaction = self.pool.begin().await.map_err(failure)?;
        if !try_lock(&mut transaction, c).await? {
            return Ok(None);
        }
        Ok(Some(Box::new(PgSubscriptionGuard {
            _transaction: transaction,
            _slot: slot,
        })))
    }
    pub(super) async fn subscription_in_use_impl(&self, c: &Connection) -> PortResult<bool> {
        if c.provider == Provider::Whatsapp
            && let Some(business) = &c.business_account_id
        {
            return sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM meta_messaging_connection
                WHERE provider='whatsapp' AND business_account_id=$1 AND status<>'disconnected') AS "exists!""#,business.as_str())
                .fetch_one(&self.pool).await.map_err(failure);
        }
        sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM meta_messaging_connection
            WHERE provider=$1 AND account_id=$2 AND status<>'disconnected') AS "exists!""#,
            c.provider.as_str(),
            c.account_id.as_str()
        )
        .fetch_one(&self.pool)
        .await
        .map_err(failure)
    }
}

pub(super) async fn try_lock(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    c: &Connection,
) -> PortResult<bool> {
    let key = key(c);
    sqlx::query_scalar!(
        r#"SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS "locked!""#,
        key
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(failure)
}
