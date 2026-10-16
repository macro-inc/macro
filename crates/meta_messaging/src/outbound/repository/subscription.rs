//! Serialize shared Meta subscriptions through PostgreSQL across service instances.
use super::*;

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
    // An OAuth code has already been exchanged. Wait briefly for in-flight lifecycle
    // I/O instead of discarding that grant on ordinary contention. Waiters release
    // their transaction/slot between attempts so the lock owner can finish its queries.
    pub(super) async fn connect_transaction(
        &self,
        c: &Connection,
    ) -> PortResult<(
        tokio::sync::OwnedSemaphorePermit,
        sqlx::Transaction<'static, sqlx::Postgres>,
    )> {
        tokio::time::timeout(std::time::Duration::from_secs(60), async {
            loop {
                let slot = self
                    .subscription_slots
                    .clone()
                    .acquire_owned()
                    .await
                    .map_err(|_| MessagingError::Unavailable)?;
                let mut tx = self.pool.begin().await.map_err(failure)?;
                if try_lock(&mut tx, c).await? {
                    return Ok((slot, tx));
                }
                drop(tx);
                drop(slot);
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        })
        .await
        .map_err(|_| MessagingError::Unavailable)?
    }

    pub(super) async fn lock_subscription_impl(
        &self,
        c: &Connection,
    ) -> PortResult<Option<Box<dyn SubscriptionGuard>>> {
        let Ok(slot) = self.subscription_slots.clone().try_acquire_owned() else {
            return Ok(None);
        };
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
