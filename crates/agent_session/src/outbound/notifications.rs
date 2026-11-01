//! PostgreSQL outbox. Only this adapter touches agent_session_notification.
use crate::domain::{error::AgentSessionError, model::AgentSessionId, notifications::*};
use agent_runtime_protocol::domain::{action::AgentActionId, notification::Notification};
use macro_uuid::Uuid;
use sqlx::{PgConnection, PgPool, types::Json};

/// Shared pool-backed outbox; clones share no delivery state.
#[derive(Clone)]
pub struct PgNotificationStore(pub PgPool);

fn storage(error: impl std::error::Error + Send + Sync + 'static) -> AgentSessionError {
    rootcause::Report::new(error).into_dynamic().into()
}

impl NotificationWriter<PgConnection> for PgNotificationStore {
    fn produce<'a>(
        &'a self,
        transaction: &'a mut PgConnection,
        pending: &'a PendingNotification,
    ) -> NotificationFuture<'a, ()> {
        Box::pin(async move {
            let event = serde_json::to_value(&pending.notification.event).map_err(storage)?;
            let at = chrono::DateTime::parse_from_rfc3339(&pending.notification.created_at)
                .map_err(storage)?;
            sqlx::query!(
                "INSERT INTO agent_session_notification (id, session_id, kind, subject_id, payload, dedupe_key, wake, created_at, producer_context) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (session_id, dedupe_key) DO NOTHING",
                pending.notification.id, pending.session_id.as_uuid(), pending.notification.event.kind(),
                pending.notification.subject_id, event["payload"].clone(), pending.dedupe_key,
                pending.wake, at, Json(&pending.producer_context) as _,
            ).execute(transaction).await.map_err(storage)?;
            Ok(())
        })
    }
}

impl NotificationStore for PgNotificationStore {
    fn enqueue(&self, notification: PendingNotification) -> NotificationFuture<'_, ()> {
        Box::pin(async move {
            let mut transaction = self.0.begin().await.map_err(storage)?;
            self.produce(&mut *transaction, &notification).await?;
            transaction.commit().await.map_err(storage)?;
            Ok(())
        })
    }
    fn pending_sessions(
        &self,
        after: Option<AgentSessionId>,
    ) -> NotificationFuture<'_, Vec<AgentSessionId>> {
        Box::pin(async move {
            Ok(sqlx::query_scalar!(
                "SELECT DISTINCT n.session_id FROM agent_session_notification n JOIN agent_session s ON s.id = n.session_id WHERE n.delivered_at IS NULL AND (n.wake OR n.action_id IS NOT NULL) AND (n.lease_until IS NULL OR n.lease_until < now()) AND NOT s.is_archived AND ($1::uuid IS NULL OR n.session_id > $1) ORDER BY n.session_id LIMIT 100",
                after.map(|id| id.as_uuid()),
            ).fetch_all(&self.0).await.map_err(storage)?.into_iter().map(AgentSessionId::new_from_uuid).collect())
        })
    }
    fn claim(
        &self,
        session: AgentSessionId,
        real_prompt: bool,
    ) -> NotificationFuture<'_, Option<NotificationBatch>> {
        Box::pin(async move {
            let mut transaction = self.0.begin().await.map_err(storage)?;
            // Serialize claims per session across replicas. Do not hold this lock
            // during runtime I/O or while the model is responding.
            let locked = sqlx::query_scalar!(
                "SELECT id FROM agent_session WHERE id = $1 FOR UPDATE SKIP LOCKED",
                session.as_uuid()
            )
            .fetch_optional(&mut *transaction)
            .await
            .map_err(storage)?;
            if locked.is_none() {
                transaction.rollback().await.map_err(storage)?;
                return Ok(None);
            }
            let blocked = sqlx::query_scalar!("SELECT EXISTS(SELECT 1 FROM agent_session_notification WHERE session_id = $1 AND delivered_at IS NULL AND lease_id IS NOT NULL AND lease_until > now())", session.as_uuid())
                .fetch_one(&mut *transaction).await.map_err(storage)?.unwrap_or(false);
            if blocked {
                transaction.rollback().await.map_err(storage)?;
                return Ok(None);
            }
            let retry_action = sqlx::query_scalar!("SELECT action_id FROM agent_session_notification WHERE session_id = $1 AND delivered_at IS NULL AND (lease_until IS NULL OR lease_until < now()) AND ($2 OR wake OR action_id IS NOT NULL) ORDER BY (action_id IS NULL), created_at, id LIMIT 1", session.as_uuid(), real_prompt)
                .fetch_optional(&mut *transaction).await.map_err(storage)?.flatten();
            let lease = macro_uuid::generate_uuid_v7();
            let action = AgentActionId::mint();
            let rows = sqlx::query!(
                r#"
                WITH candidates AS (
                    SELECT id FROM agent_session_notification
                    WHERE session_id = $1 AND delivered_at IS NULL
                      AND (lease_until IS NULL OR lease_until < now())
                      AND (($5::uuid IS NULL AND action_id IS NULL) OR action_id = $5)
                      AND ($2 OR wake OR action_id IS NOT NULL)
                    ORDER BY created_at, id LIMIT 100 FOR UPDATE SKIP LOCKED
                )
                UPDATE agent_session_notification n SET lease_id = $3,
                    lease_until = now() + interval '2 minutes', attempts = attempts + 1,
                    action_id = COALESCE(n.action_id, $4)
                FROM candidates c WHERE n.id = c.id
                RETURNING n.id, n.kind, n.subject_id, n.payload, n.created_at,
                    n.action_id AS "action_id!", n.wake, n.producer_context, n.dedupe_key
            "#,
                session.as_uuid(),
                real_prompt,
                lease,
                action.as_uuid(),
                retry_action
            )
            .fetch_all(&mut *transaction)
            .await
            .map_err(storage)?;
            if rows.is_empty() {
                // Dropping a transaction only queues its rollback. Release the
                // session lock before a following real prompt tries to claim.
                transaction.rollback().await.map_err(storage)?;
                return Ok(None);
            }
            let mut rows = rows;
            rows.sort_by_key(|row| (row.created_at, row.id));
            let action_id = AgentActionId::from_uuid(rows[0].action_id);
            // Only the migration bridge uses the event ID as its original
            // action and exact legacy dedupe key. A recovered old hidden
            // prompt must lose owner authority without touching a newer turn.
            if rows.iter().any(|row| {
                row.action_id == row.id && row.dedupe_key == format!("review.legacy:{}", row.id)
            }) {
                sqlx::query!(
                    "UPDATE agent_session SET turn_prompter_kind = 'system', turn_prompter = NULL WHERE id = $1 AND turn_action_id = $2",
                    session.as_uuid(), action_id.as_uuid(),
                ).execute(&mut *transaction).await.map_err(storage)?;
            }
            let decoded: Vec<_> = rows
                .iter()
                .map(|row| {
                    serde_json::from_value(
                        serde_json::json!({"kind": row.kind, "payload": row.payload}),
                    )
                })
                .collect::<Vec<
                    std::result::Result<
                        agent_runtime_protocol::domain::notification::NotificationEvent,
                        _,
                    >,
                >>();
            // An older replica must not deliver only part of an already-bound
            // action: its eventual Finished record would consume unseen siblings.
            let quarantine_batch = retry_action.is_some() && decoded.iter().any(Result::is_err);
            if quarantine_batch {
                tracing::warn!(session_id = %session, %action_id,
                    "bound notification payload unavailable; reconcile original action before retry");
                let wake = rows.iter().any(|row| row.wake);
                transaction.commit().await.map_err(storage)?;
                return Ok(Some(NotificationBatch {
                    lease_id: lease,
                    action_id,
                    wake,
                    notifications: Vec::new(),
                    producer_contexts: Vec::new(),
                }));
            }
            let mut wake = false;
            let mut notifications = Vec::new();
            let mut producer_contexts = Vec::new();
            for (row, event) in rows.into_iter().zip(decoded) {
                if event.is_err() {
                    tracing::warn!(notification_id = %row.id, session_id = %session,
                        "notification payload unavailable to this consumer; retaining for retry");
                    sqlx::query!(
                        "UPDATE agent_session_notification SET lease_id = NULL, lease_until = now() + interval '2 minutes', action_id = $2 WHERE id = $1",
                        row.id, retry_action,
                    ).execute(&mut *transaction).await.map_err(storage)?;
                    continue;
                }
                let event = event.map_err(storage)?;
                wake |= row.wake;
                notifications.push(Notification {
                    id: row.id,
                    subject_id: row.subject_id,
                    created_at: row.created_at.to_rfc3339(),
                    event,
                });
                producer_contexts
                    .push(serde_json::from_value(row.producer_context).unwrap_or_default());
            }
            transaction.commit().await.map_err(storage)?;
            if notifications.is_empty() {
                return Ok(None);
            }
            Ok(Some(NotificationBatch {
                lease_id: lease,
                action_id,
                wake,
                notifications,
                producer_contexts,
            }))
        })
    }
    fn bind_action(&self, lease: Uuid, action: AgentActionId) -> NotificationFuture<'_, ()> {
        Box::pin(async move {
            let updated = sqlx::query!("UPDATE agent_session_notification SET action_id = $2 WHERE lease_id = $1 AND delivered_at IS NULL", lease, action.as_uuid())
                .execute(&self.0).await.map_err(storage)?;
            if updated.rows_affected() == 0 {
                return Err(rootcause::report!("notification delivery lease was lost").into());
            }
            Ok(())
        })
    }
    fn defer_until_prompt(&self, lease: Uuid) -> NotificationFuture<'_, ()> {
        Box::pin(async move {
            sqlx::query!("UPDATE agent_session_notification SET lease_id = NULL, lease_until = NULL, action_id = NULL WHERE lease_id = $1 AND delivered_at IS NULL", lease)
                .execute(&self.0).await.map_err(storage)?;
            Ok(())
        })
    }
    fn renew(&self, lease: Uuid) -> NotificationFuture<'_, ()> {
        Box::pin(async move {
            sqlx::query!("UPDATE agent_session_notification SET lease_until = now() + interval '2 minutes' WHERE lease_id = $1 AND delivered_at IS NULL", lease)
                .execute(&self.0).await.map_err(storage)?;
            Ok(())
        })
    }
    fn complete(&self, lease: Uuid, outcome: NotificationOutcome) -> NotificationFuture<'_, ()> {
        Box::pin(async move {
            let outcome = match outcome {
                NotificationOutcome::Delivered => "delivered",
                NotificationOutcome::Noop => "noop",
            };
            sqlx::query!("UPDATE agent_session_notification SET delivered_at = now(), outcome = $2, lease_until = NULL WHERE lease_id = $1 AND delivered_at IS NULL", lease, outcome)
                .execute(&self.0).await.map_err(storage)?;
            Ok(())
        })
    }
    fn release(&self, lease: Uuid) -> NotificationFuture<'_, ()> {
        Box::pin(async move {
            sqlx::query!("UPDATE agent_session_notification SET lease_until = NULL, lease_id = NULL WHERE lease_id = $1 AND delivered_at IS NULL", lease)
                .execute(&self.0).await.map_err(storage)?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod test;
