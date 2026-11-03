use crate::domain::{
    models::*,
    ports::{Result, SyncRepository},
};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use row_cipher::RowCipher;
use sqlx::PgPool;
use uuid::Uuid;

/// Signing secrets are sealed with their connection id.
pub struct PgSyncRepository {
    pool: PgPool,
    cipher: RowCipher,
}

impl PgSyncRepository {
    /// Storage over `pool`, sealing signing secrets under `key`.
    pub fn new(pool: PgPool, key: &[u8; 32]) -> Self {
        Self {
            pool,
            cipher: RowCipher::new(key),
        }
    }

    fn seal(&self, id: Uuid, secret: &SigningSecret) -> Result<Vec<u8>> {
        self.cipher
            .seal(id, secret.0.as_bytes())
            .map_err(|_| rootcause::report!("could not encrypt webhook secret"))
    }

    fn open(&self, id: Uuid, sealed: &[u8]) -> Result<SigningSecret> {
        let plaintext = self
            .cipher
            .open(id, sealed)
            .map_err(|_| rootcause::report!("could not decrypt webhook secret"))?;
        Ok(SigningSecret(String::from_utf8(plaintext)?))
    }

    async fn ids(&self, ids: Vec<Uuid>) -> Result<Vec<Connection>> {
        let mut connections = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(connection) = self.by_id(id).await? {
                connections.push(connection);
            }
        }
        Ok(connections)
    }
}

/// Setup waits out another instance's lease, and failed setups retry hourly.
const SETUP_LEASE_SECONDS: f64 = 120.0;
const SETUP_RETRY_SECONDS: f64 = 3600.0;
/// Events stay long enough to rebuild a call when a late recap arrives.
const EVENT_RETENTION_DAYS: i32 = 30;

#[async_trait]
impl SyncRepository for PgSyncRepository {
    async fn by_user(&self, user: &MacroUserIdStr<'static>) -> Result<Option<Connection>> {
        let id = sqlx::query_scalar!(
            "SELECT id FROM dialpad_sync_connections WHERE user_id = $1",
            user.as_ref()
        )
        .fetch_optional(&self.pool)
        .await?;
        match id {
            Some(id) => self.by_id(id).await,
            None => Ok(None),
        }
    }

    async fn by_id(&self, id: Uuid) -> Result<Option<Connection>> {
        let row = sqlx::query!(
            r#"SELECT id, namespace, user_id, enabled, dialpad_user_id, webhook_id, subscription_id,
                signing_secret, backfill_since, backfill_cursor, enrolled_at, last_synced_at, last_error
            FROM dialpad_sync_connections WHERE id = $1"#,
            id
        )
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else {
            return Ok(None);
        };
        Ok(Some(Connection {
            id: row.id,
            namespace: row.namespace,
            user_id: MacroUserIdStr::parse_from_str(&row.user_id)?.into_owned(),
            enabled: row.enabled,
            dialpad_user_id: row.dialpad_user_id.map(DialpadId),
            registration: row
                .webhook_id
                .zip(row.subscription_id)
                .map(|(webhook, subscription)| Registration {
                    webhook_id: DialpadId(webhook),
                    subscription_id: DialpadId(subscription),
                }),
            secret: row
                .signing_secret
                .map(|sealed| self.open(row.id, &sealed))
                .transpose()?,
            backfill: match row.backfill_since {
                Some(since) => BackfillState::Pending {
                    since,
                    cursor: row.backfill_cursor,
                },
                None => BackfillState::Done,
            },
            enrolled_at: row.enrolled_at,
            last_synced_at: row.last_synced_at,
            last_error: row.last_error.as_deref().map(str::parse).transpose()?,
        }))
    }

    async fn enroll(
        &self,
        user: &MacroUserIdStr<'static>,
        backfill_since: Option<DateTime<Utc>>,
    ) -> Result<()> {
        let id = macro_uuid::generate_uuid_v7();
        sqlx::query!(
            r#"INSERT INTO dialpad_sync_connections (id, user_id, namespace, backfill_since)
            VALUES ($1, $2, $1, $3)
            ON CONFLICT (user_id) DO UPDATE SET
                enrolled_at = now(),
                last_error = NULL,
                backfill_since = CASE WHEN dialpad_sync_connections.enabled
                    THEN dialpad_sync_connections.backfill_since ELSE EXCLUDED.backfill_since END,
                backfill_cursor = CASE WHEN dialpad_sync_connections.enabled
                    THEN dialpad_sync_connections.backfill_cursor ELSE NULL END"#,
            id,
            user.as_ref(),
            backfill_since
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn awaiting_setup(&self, limit: i64) -> Result<Vec<Connection>> {
        let ids = sqlx::query_scalar!(
            r#"SELECT id FROM dialpad_sync_connections
            WHERE NOT enabled
                AND (setup_started_at IS NULL
                    OR setup_started_at < now() - make_interval(secs => $1))
                AND (last_error IS NULL
                    OR (last_error = $2 AND setup_started_at < now() - make_interval(secs => $3)))
            ORDER BY enrolled_at LIMIT $4"#,
            SETUP_LEASE_SECONDS,
            SyncIssue::SetupFailed.as_ref(),
            SETUP_RETRY_SECONDS,
            limit
        )
        .fetch_all(&self.pool)
        .await?;
        self.ids(ids).await
    }

    async fn begin_setup(&self, id: Uuid, secret: &SigningSecret) -> Result<bool> {
        let sealed = self.seal(id, secret)?;
        let changed = sqlx::query!(
            r#"UPDATE dialpad_sync_connections
            SET setup_started_at = now(), signing_secret = $2, last_error = NULL
            WHERE id = $1 AND NOT enabled
                AND (setup_started_at IS NULL
                    OR setup_started_at < now() - make_interval(secs => $3))
                AND (last_error IS NULL
                    OR (last_error = $4 AND setup_started_at < now() - make_interval(secs => $5)))"#,
            id,
            sealed,
            SETUP_LEASE_SECONDS,
            SyncIssue::SetupFailed.as_ref(),
            SETUP_RETRY_SECONDS
        )
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(changed == 1)
    }

    async fn activate(
        &self,
        id: Uuid,
        dialpad_user: DialpadId,
        registration: Registration,
    ) -> Result<bool> {
        let changed = sqlx::query!(
            r#"UPDATE dialpad_sync_connections
            SET enabled = true, dialpad_user_id = $2, webhook_id = $3, subscription_id = $4,
                setup_started_at = NULL, last_error = NULL
            WHERE id = $1 AND NOT enabled AND setup_started_at IS NOT NULL AND last_error IS NULL"#,
            id,
            dialpad_user.0,
            registration.webhook_id.0,
            registration.subscription_id.0
        )
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(changed == 1)
    }

    async fn stop(&self, id: Uuid, issue: SyncIssue) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query!(
            "UPDATE dialpad_sync_connections SET enabled = false, last_error = $2 WHERE id = $1",
            id,
            issue.as_ref()
        )
        .execute(tx.as_mut())
        .await?;
        sqlx::query!(
            "DELETE FROM dialpad_sync_events WHERE connection_id = $1 AND completed_at IS NULL",
            id
        )
        .execute(tx.as_mut())
        .await?;
        tx.commit().await?;
        Ok(())
    }

    async fn flag(&self, id: Uuid, issue: SyncIssue) -> Result<()> {
        sqlx::query!(
            "UPDATE dialpad_sync_connections SET last_error = $2 WHERE id = $1 AND enabled",
            id,
            issue.as_ref()
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn disconnect(&self, id: Uuid, unregistered: bool) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query!(
            r#"UPDATE dialpad_sync_connections
            SET enabled = false, last_error = $2, setup_started_at = NULL,
                webhook_id = CASE WHEN $3 THEN NULL ELSE webhook_id END,
                subscription_id = CASE WHEN $3 THEN NULL ELSE subscription_id END
            WHERE id = $1"#,
            id,
            SyncIssue::Disconnected.as_ref(),
            unregistered
        )
        .execute(tx.as_mut())
        .await?;
        sqlx::query!(
            "DELETE FROM dialpad_sync_events WHERE connection_id = $1 AND completed_at IS NULL",
            id
        )
        .execute(tx.as_mut())
        .await?;
        tx.commit().await?;
        Ok(())
    }

    async fn backfilling(&self, limit: i64) -> Result<Vec<Connection>> {
        let ids = sqlx::query_scalar!(
            r#"SELECT id FROM dialpad_sync_connections
            WHERE enabled AND backfill_since IS NOT NULL
            ORDER BY enrolled_at LIMIT $1"#,
            limit
        )
        .fetch_all(&self.pool)
        .await?;
        self.ids(ids).await
    }

    async fn advance_backfill(
        &self,
        id: Uuid,
        calls: Vec<CallEvent>,
        cursor: Option<String>,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        for call in calls {
            let Some(occurred_at) = call.occurred_at() else {
                continue;
            };
            sqlx::query!(
                r#"INSERT INTO dialpad_sync_events (connection_id, call_id, state, occurred_at, payload)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT DO NOTHING"#,
                id,
                call.call_id.0,
                call.state.as_ref(),
                occurred_at,
                serde_json::to_value(&call)?
            )
            .execute(tx.as_mut())
            .await?;
        }
        sqlx::query!(
            r#"UPDATE dialpad_sync_connections
            SET backfill_cursor = $2,
                backfill_since = CASE WHEN $2::text IS NULL THEN NULL ELSE backfill_since END
            WHERE id = $1 AND enabled"#,
            id,
            cursor
        )
        .execute(tx.as_mut())
        .await?;
        tx.commit().await?;
        Ok(())
    }

    async fn enqueue(&self, id: Uuid, event: CallEvent, traceparent: Option<String>) -> Result<()> {
        let occurred_at = event
            .occurred_at()
            .ok_or_else(|| rootcause::report!("Dialpad event has no timestamp"))?;
        sqlx::query!(
            r#"INSERT INTO dialpad_sync_events (connection_id, call_id, state, occurred_at, payload, traceparent)
            SELECT id, $2, $3, $4, $5, $6 FROM dialpad_sync_connections
            -- Running, or mid-setup (deliveries can beat activation); never stopped.
            WHERE id = $1 AND (enabled OR (setup_started_at IS NOT NULL AND last_error IS NULL))
            ON CONFLICT DO NOTHING"#,
            id,
            event.call_id.0,
            event.state.as_ref(),
            occurred_at,
            serde_json::to_value(&event)?,
            traceparent
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn claim(&self) -> Result<Option<Job>> {
        let lease = macro_uuid::generate_uuid_v7();
        let row = sqlx::query!(
            r#"WITH candidate AS (
                SELECT e.connection_id, e.call_id, e.state, e.occurred_at FROM dialpad_sync_events e
                JOIN dialpad_sync_connections c ON c.id = e.connection_id
                WHERE e.completed_at IS NULL AND e.available_at <= now() AND c.enabled
                ORDER BY e.available_at LIMIT 1 FOR UPDATE OF e SKIP LOCKED
            )
            UPDATE dialpad_sync_events e SET lease_id = $1, attempts = e.attempts + 1,
                available_at = now() + interval '10 minutes'
            FROM candidate c
            WHERE e.connection_id = c.connection_id AND e.call_id = c.call_id
                AND e.state = c.state AND e.occurred_at = c.occurred_at
            RETURNING e.connection_id, e.call_id, e.state, e.occurred_at, e.traceparent, e.attempts"#,
            lease
        )
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else {
            return Ok(None);
        };
        let Some(connection) = self.by_id(row.connection_id).await? else {
            return Ok(None);
        };
        Ok(Some(Job {
            connection,
            call_id: DialpadId(row.call_id),
            state: row.state.parse()?,
            occurred_at: row.occurred_at,
            traceparent: row.traceparent,
            lease_id: lease,
            attempts: row.attempts,
        }))
    }

    async fn events(&self, id: Uuid, call: DialpadId) -> Result<Vec<CallEvent>> {
        let payloads = sqlx::query_scalar!(
            r#"SELECT payload FROM dialpad_sync_events
            WHERE connection_id = $1 AND call_id = $2 ORDER BY occurred_at"#,
            id,
            call.0
        )
        .fetch_all(&self.pool)
        .await?;
        payloads
            .into_iter()
            .map(|payload| Ok(serde_json::from_value(payload)?))
            .collect()
    }

    async fn finish(&self, job: &Job, success: bool) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let retry_seconds = 5_i32
            .saturating_mul(2_i32.saturating_pow(job.attempts.min(10) as u32))
            .min(3600);
        let changed = sqlx::query!(
            r#"UPDATE dialpad_sync_events SET completed_at = CASE WHEN $6 THEN now() ELSE NULL END,
                available_at = now() + make_interval(secs => $7::double precision), lease_id = NULL
            WHERE connection_id = $1 AND call_id = $2 AND state = $3 AND occurred_at = $4
                AND lease_id = $5"#,
            job.connection.id,
            job.call_id.0,
            job.state.as_ref(),
            job.occurred_at,
            job.lease_id,
            success,
            f64::from(retry_seconds)
        )
        .execute(tx.as_mut())
        .await?
        .rows_affected();
        if changed == 1 {
            sqlx::query!(
                r#"UPDATE dialpad_sync_connections
                SET last_synced_at = CASE WHEN $2 THEN now() ELSE last_synced_at END,
                    -- A reconnect prompt outranks a generic retry notice.
                    last_error = CASE WHEN $2 THEN NULL
                        WHEN last_error = $4 THEN last_error ELSE $3 END
                WHERE id = $1 AND enabled"#,
                job.connection.id,
                success,
                SyncIssue::CallSyncFailed.as_ref(),
                SyncIssue::NeedsReauth.as_ref()
            )
            .execute(tx.as_mut())
            .await?;
        }
        // Forget a call once all its events are done and it has gone quiet.
        sqlx::query!(
            r#"DELETE FROM dialpad_sync_events WHERE connection_id = $1 AND call_id IN (
                SELECT call_id FROM dialpad_sync_events WHERE connection_id = $1
                GROUP BY call_id
                HAVING bool_and(completed_at IS NOT NULL)
                    AND max(received_at) < now() - make_interval(days => $2)
            )"#,
            job.connection.id,
            EVENT_RETENTION_DAYS
        )
        .execute(tx.as_mut())
        .await?;
        tx.commit().await?;
        Ok(())
    }
}

#[cfg(test)]
mod test;
