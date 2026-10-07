use crate::domain::{
    models::*,
    ports::{Result, SyncRepository},
};
use aes_gcm::{
    Aes256Gcm, KeyInit,
    aead::{Aead, AeadCore, OsRng, Payload},
};
use async_trait::async_trait;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::PgPool;
use uuid::Uuid;

/// Signing secrets are encrypted at rest and bound to their connection ID.
pub struct PgSyncRepository {
    pool: PgPool,
    cipher: Aes256Gcm,
}

impl PgSyncRepository {
    pub fn new(pool: PgPool, key: &[u8; 32]) -> Self {
        Self {
            pool,
            cipher: Aes256Gcm::new(key.into()),
        }
    }
    fn encrypt(&self, id: Uuid, secret: SigningSecret) -> Result<Vec<u8>> {
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = self
            .cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: secret.0.as_bytes(),
                    aad: id.as_bytes(),
                },
            )
            .map_err(|_| rootcause::report!("could not encrypt webhook secret"))?;
        Ok([&nonce[..], &ciphertext].concat())
    }
    fn decrypt(&self, id: Uuid, data: Vec<u8>) -> Result<SigningSecret> {
        if data.len() < 12 {
            return Err(rootcause::report!("invalid encrypted webhook secret"));
        }
        let plaintext = self
            .cipher
            .decrypt(
                data[..12].into(),
                Payload {
                    msg: &data[12..],
                    aad: id.as_bytes(),
                },
            )
            .map_err(|_| rootcause::report!("could not decrypt webhook secret"))?;
        Ok(SigningSecret(String::from_utf8(plaintext)?))
    }
}

#[async_trait]
impl SyncRepository for PgSyncRepository {
    async fn by_user(&self, user: &MacroUserIdStr<'static>) -> Result<Option<Connection>> {
        let row = sqlx::query!(
            "SELECT id FROM granola_sync_connections WHERE user_id = $1",
            user.as_ref()
        )
        .fetch_optional(&self.pool)
        .await?;
        match row {
            Some(row) => self.by_id(row.id).await,
            None => Ok(None),
        }
    }
    async fn by_id(&self, id: Uuid) -> Result<Option<Connection>> {
        let row = sqlx::query!("SELECT * FROM granola_sync_connections WHERE id = $1", id)
            .fetch_optional(&self.pool)
            .await?;
        row.map(|row| {
            Ok(Connection {
                id: row.id,
                namespace: row.namespace,
                user_id: MacroUserIdStr::parse_from_str(&row.user_id)?.into_owned(),
                account_id: row.account_id,
                scope: serde_json::from_value(serde_json::Value::String(row.scope))?,
                enabled: row.enabled,
                endpoint_id: row.endpoint_id,
                secret: row
                    .signing_secret
                    .map(|s| self.decrypt(id, s))
                    .transpose()?,
                started_at: row.started_at,
                last_synced_at: row.last_synced_at,
                last_error: row.last_error,
            })
        })
        .transpose()
    }
    async fn reserve(&self, connection: &Connection) -> Result<bool> {
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query!(
            r#"INSERT INTO granola_sync_connections (id, user_id, account_id, scope, started_at, namespace)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (user_id) DO UPDATE SET id = EXCLUDED.id, account_id = EXCLUDED.account_id,
                scope = EXCLUDED.scope, started_at = EXCLUDED.started_at, enabled = false,
                endpoint_id = NULL, signing_secret = NULL, last_error = NULL, last_synced_at = NULL
            WHERE granola_sync_connections.endpoint_id IS NOT NULL
                OR granola_sync_connections.last_error IS NOT NULL
                OR granola_sync_connections.started_at < now() - interval '2 minutes'
            RETURNING id"#,
            connection.id, connection.user_id.as_ref(), connection.account_id,
            connection.scope.as_str(), connection.started_at, connection.namespace
        ).fetch_optional(tx.as_mut()).await?;
        if row.is_some() {
            sqlx::query!(
                "DELETE FROM granola_sync_events WHERE connection_id = $1",
                connection.id
            )
            .execute(tx.as_mut())
            .await?;
        }
        tx.commit().await?;
        Ok(row.is_some())
    }
    async fn activate(&self, id: Uuid, webhook: Webhook) -> Result<bool> {
        let encrypted = self.encrypt(id, webhook.secret)?;
        let changed = sqlx::query!(
            "UPDATE granola_sync_connections SET enabled = true, endpoint_id = $2, signing_secret = $3
             WHERE id = $1 AND last_error IS NULL AND endpoint_id IS NULL",
            id, webhook.id, encrypted
        ).execute(&self.pool).await?.rows_affected();
        Ok(changed == 1)
    }
    async fn stop(&self, id: Uuid) -> Result<()> {
        sqlx::query!("UPDATE granola_sync_connections SET enabled = false, last_error = 'Sync stopped' WHERE id = $1", id)
            .execute(&self.pool).await?;
        Ok(())
    }
    async fn failed_setup(&self, id: Uuid) -> Result<()> {
        sqlx::query!("UPDATE granola_sync_connections SET enabled = false, last_error = 'Could not register webhook. Check your Granola key scope and plan, then retry.' WHERE id = $1", id)
            .execute(&self.pool).await?;
        Ok(())
    }
    async fn enqueue(&self, id: Uuid, event: Event) -> Result<()> {
        sqlx::query!(
            r#"INSERT INTO granola_sync_events (connection_id, event_id, note_id, event_type, occurred_at)
            SELECT id, $2, $3, $4, $5 FROM granola_sync_connections WHERE id = $1 AND enabled
            ON CONFLICT (connection_id, event_id) DO NOTHING"#,
            id, event.event_id, event.note_id.as_ref(), event.event_type.as_str(), event.occurred_at
        ).execute(&self.pool).await?;
        Ok(())
    }
    async fn claim(&self) -> Result<Option<Job>> {
        let lease = macro_uuid::generate_uuid_v7();
        let row = sqlx::query!(
            r#"WITH candidate AS (
                SELECT e.connection_id, e.event_id FROM granola_sync_events e
                JOIN granola_sync_connections c ON c.id = e.connection_id
                WHERE e.completed_at IS NULL AND e.available_at <= now() AND c.enabled
                ORDER BY e.available_at LIMIT 1 FOR UPDATE OF e SKIP LOCKED
            )
            UPDATE granola_sync_events e SET lease_id = $1, attempts = e.attempts + 1,
                available_at = now() + interval '10 minutes'
            FROM candidate c WHERE e.connection_id = c.connection_id AND e.event_id = c.event_id
            RETURNING e.connection_id, e.event_id, e.note_id, e.event_type, e.occurred_at, e.attempts"#,
            lease
        ).fetch_optional(&self.pool).await?;
        let Some(row) = row else {
            return Ok(None);
        };
        let Some(connection) = self.by_id(row.connection_id).await? else {
            return Ok(None);
        };
        Ok(Some(Job {
            connection,
            lease_id: lease,
            attempts: row.attempts,
            event: Event {
                event_id: row.event_id,
                note_id: row
                    .note_id
                    .try_into()
                    .map_err(|e| rootcause::report!("{e}"))?,
                event_type: serde_json::from_value(serde_json::Value::String(row.event_type))?,
                occurred_at: row.occurred_at,
            },
        }))
    }
    async fn finish(&self, job: &Job, success: bool) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let retry_seconds = 5_i32
            .saturating_mul(2_i32.saturating_pow(job.attempts.min(10) as u32))
            .min(3600);
        let changed = sqlx::query!(
            r#"UPDATE granola_sync_events SET completed_at = CASE WHEN $4 THEN now() ELSE NULL END,
                available_at = now() + make_interval(secs => $5::double precision), lease_id = NULL
            WHERE connection_id = $1 AND event_id = $2 AND lease_id = $3"#,
            job.connection.id,
            job.event.event_id,
            job.lease_id,
            success,
            f64::from(retry_seconds)
        )
        .execute(tx.as_mut())
        .await?
        .rows_affected();
        if changed == 1 {
            sqlx::query!(
                r#"UPDATE granola_sync_connections
                SET last_synced_at = CASE WHEN $2 THEN now() ELSE last_synced_at END,
                    last_error = CASE WHEN $2 THEN NULL ELSE 'Meeting sync failed; retrying automatically' END
                WHERE id = $1 AND enabled"#,
                job.connection.id, success
            ).execute(tx.as_mut()).await?;
        }
        // Keep deduplication records longer than Granola's four-day retry window.
        sqlx::query!("DELETE FROM granola_sync_events WHERE connection_id = $1 AND completed_at < now() - interval '7 days'", job.connection.id)
            .execute(tx.as_mut()).await?;
        tx.commit().await?;
        Ok(())
    }
}

#[cfg(test)]
mod test;
