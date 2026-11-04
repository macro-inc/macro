//! Durable suppression of notifications whose underlying work was resolved.
use crate::domain::ports::NotificationWithdrawal;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

/// Database-backed notification withdrawal port.
pub struct PgNotificationWithdrawal(pub PgPool);

pub(crate) async fn lock_notification(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
) -> Result<(), rootcause::Report> {
    let key = format!("notification:{id}");
    sqlx::query!("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", key)
        .execute(tx.as_mut())
        .await?;
    Ok(())
}

impl NotificationWithdrawal for PgNotificationWithdrawal {
    async fn withdraw(&self, id: Uuid) -> Result<(), rootcause::Report> {
        let mut tx = self.0.begin().await?;
        lock_notification(&mut tx, id).await?;
        sqlx::query!("INSERT INTO notification_withdrawal(notification_id) VALUES ($1) ON CONFLICT DO NOTHING", id).execute(tx.as_mut()).await?;
        tx.commit().await?;
        Ok(())
    }
}

#[cfg(test)]
mod test;
