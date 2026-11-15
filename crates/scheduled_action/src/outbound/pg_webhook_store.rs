//! Routine webhooks' rows, and their deliveries' admission to the event-run
//! queue. Like every queue write, admission locks the routine first.

use chrono::{DateTime, Utc};
use macro_uuid::Uuid;
use rootcause::Report;
use serde_json::Value;
use sqlx::PgPool;

use crate::domain::event_trigger::EventFilters;
use crate::domain::webhook::{
    AdmissionOutcome, HookId, SecretHash, StoredHook, WebhookAdmission, WebhookInfo, WebhookStore,
};

#[cfg(test)]
mod test;

/// PostgreSQL storage for routine webhooks: the hook id and the secret's
/// hash, never the secret.
#[derive(Clone)]
pub struct PgWebhookStore {
    pool: PgPool,
}

impl PgWebhookStore {
    /// Construct at the composition root with the shared MacroDB pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl WebhookStore for PgWebhookStore {
    async fn status(&self, action_id: Uuid) -> Result<Option<WebhookInfo>, Report> {
        Ok(sqlx::query!(
            r#"
            SELECT hook_id, created_at, last_used_at FROM scheduled_action_webhook
            WHERE action_id = $1
            "#,
            action_id,
        )
        .fetch_optional(&self.pool)
        .await?
        .map(|row| WebhookInfo {
            hook_id: HookId::from(row.hook_id),
            created_at: row.created_at,
            last_used_at: row.last_used_at,
        }))
    }

    async fn replace(
        &self,
        action_id: Uuid,
        hook_id: HookId,
        secret_hash: SecretHash,
        created_at: DateTime<Utc>,
    ) -> Result<bool, Report> {
        let mut tx = self.pool.begin().await?;
        // Under the routine's lock, so a save removing the filter either
        // comes first and refuses this, or comes after and deletes it.
        let has_trigger = sqlx::query_scalar!(
            r#"
            SELECT COALESCE(jsonb_path_exists(event_filters, '$[*].events[*] ? (@ == "webhook")'), FALSE) AS "has_trigger!"
            FROM scheduled_action WHERE id = $1 FOR UPDATE
            "#,
            action_id,
        )
        .fetch_optional(&mut *tx)
        .await?
        .unwrap_or(false);
        if !has_trigger {
            tx.rollback().await?;
            return Ok(false);
        }
        sqlx::query!(
            r#"
            INSERT INTO scheduled_action_webhook (action_id, hook_id, secret_hash, created_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (action_id) DO UPDATE
            SET hook_id = EXCLUDED.hook_id, secret_hash = EXCLUDED.secret_hash,
                created_at = EXCLUDED.created_at, last_used_at = NULL
            "#,
            action_id,
            hook_id.as_uuid(),
            secret_hash.as_bytes().as_slice(),
            created_at,
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(true)
    }

    async fn remove(&self, action_id: Uuid) -> Result<bool, Report> {
        let removed = sqlx::query!(
            "DELETE FROM scheduled_action_webhook WHERE action_id = $1",
            action_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(removed.rows_affected() > 0)
    }

    async fn find(&self, hook_id: HookId) -> Result<Option<StoredHook>, Report> {
        let Some(row) = sqlx::query!(
            "SELECT action_id, secret_hash FROM scheduled_action_webhook WHERE hook_id = $1",
            hook_id.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await?
        else {
            return Ok(None);
        };
        Ok(Some(StoredHook {
            action_id: row.action_id,
            secret_hash: SecretHash::try_from(row.secret_hash.as_slice())?,
        }))
    }

    async fn admit(&self, admission: WebhookAdmission) -> Result<AdmissionOutcome, Report> {
        let mut tx = self.pool.begin().await?;
        // A delivery waits briefly for the routine, then answers 503 rather
        // than holding a connection while senders stack up.
        sqlx::query!("SET LOCAL lock_timeout = '2s'")
            .execute(&mut *tx)
            .await?;
        // Locks the routine, then its URL row: a rotation, a save or a claim
        // in progress settles first, and the URL row is read again once its
        // lock is ours (a row only joined would keep its first snapshot), so
        // a URL rotated or revoked meanwhile admits nothing. A removal waits
        // for this delivery to commit.
        let routine = sqlx::query!(
            r#"
            SELECT a.enabled, a.configuration_revision,
                   a.event_filters AS "event_filters!", a.event_activated_at AS "event_activated_at!"
            FROM scheduled_action a
            JOIN scheduled_action_webhook w ON w.action_id = a.id
            WHERE a.id = $1 AND w.hook_id = $2 AND w.secret_hash = $3
              AND a.event_activated_at IS NOT NULL
              AND jsonb_path_exists(a.event_filters, '$[*].events[*] ? (@ == "webhook")')
            FOR UPDATE OF a, w
            "#,
            admission.action_id,
            admission.hook_id.as_uuid(),
            admission.secret_hash.as_bytes().as_slice(),
        )
        .fetch_optional(&mut *tx)
        .await?;
        let Some(routine) = routine else {
            tx.rollback().await?;
            return Ok(AdmissionOutcome::Revoked);
        };
        let key = admission
            .event
            .webhook_delivery()
            .and_then(|delivery| delivery.idempotency_key.as_ref())
            .map(|key| key.as_str().to_owned());
        if let Some(key) = &key {
            let first = sqlx::query_scalar!(
                r#"
                SELECT event_id FROM scheduled_action_event_run
                WHERE action_id = $1 AND event_context #>> '{webhook,idempotency_key}' = $2
                  AND admitted_at >= $3
                ORDER BY admitted_at LIMIT 1
                "#,
                admission.action_id,
                key,
                admission.repeat_since,
            )
            .fetch_optional(&mut *tx)
            .await?;
            if let Some(run_id) = first {
                tx.rollback().await?;
                return Ok(AdmissionOutcome::Repeated { run_id });
            }
        }
        if !routine.enabled {
            tx.rollback().await?;
            return Ok(AdmissionOutcome::Paused);
        }
        let filters: EventFilters = serde_json::from_value(routine.event_filters)?;
        if !filters.matches(&admission.event, routine.event_activated_at) {
            tx.rollback().await?;
            return Ok(AdmissionOutcome::Unmatched);
        }
        let queued = sqlx::query_scalar!(
            r#"
            SELECT count(*) AS "queued!" FROM (
                SELECT 1 FROM scheduled_action_event_run
                WHERE action_id = $1 AND state = 'pending' LIMIT $2
            ) waiting
            "#,
            admission.action_id,
            i64::from(admission.max_queued),
        )
        .fetch_one(&mut *tx)
        .await?;
        if queued >= i64::from(admission.max_queued) {
            tx.rollback().await?;
            return Ok(AdmissionOutcome::Full);
        }
        // The event id is the row's key, not part of its context.
        let mut context = serde_json::to_value(&admission.event)?;
        if let Value::Object(fields) = &mut context {
            fields.remove("event_id");
        }
        sqlx::query!(
            r#"
            INSERT INTO scheduled_action_event_run (action_id, event_id, configuration_revision, event_context)
            VALUES ($1, $2, $3, $4)
            "#,
            admission.action_id,
            admission.event.event_id().as_uuid(),
            routine.configuration_revision,
            context,
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query!(
            "UPDATE scheduled_action_webhook SET last_used_at = now() WHERE action_id = $1",
            admission.action_id,
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(AdmissionOutcome::Admitted)
    }
}
