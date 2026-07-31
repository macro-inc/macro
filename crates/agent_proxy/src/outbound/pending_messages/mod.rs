//! Postgres-backed [`PendingMessages`] queue: the durable store behind
//! `post_acp`'s buffering of ACP messages posted before a session's runtime
//! is ready. Rows live in `agent_proxy_pending_message` and are drained per
//! session, oldest first; see the port's docs for the semantics this
//! implements.

#[cfg(test)]
mod test;

use crate::domain::ports::{PendingMessage, PendingMessages};
use agent_client_protocol::RawJsonRpcMessage;
use macro_uuid::Uuid;
use sqlx::PgPool;

/// Postgres adapter for the pending-message queue.
#[derive(Clone)]
pub struct PgPendingMessages {
    pool: PgPool,
}

impl PgPendingMessages {
    /// Create a new [`PgPendingMessages`] with the given connection pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl PendingMessages for PgPendingMessages {
    async fn enqueue(&self, session_id: Uuid, message: RawJsonRpcMessage) -> anyhow::Result<()> {
        let message = serde_json::to_value(&message)?;
        sqlx::query!(
            r#"
            INSERT INTO agent_proxy_pending_message (id, session_id, message)
            VALUES ($1, $2, $3)
            "#,
            macro_uuid::generate_uuid_v7(),
            session_id.to_string(),
            message,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn list(&self, session_id: Uuid) -> anyhow::Result<Vec<PendingMessage>> {
        let rows = sqlx::query!(
            r#"
            SELECT id, message
            FROM agent_proxy_pending_message
            WHERE session_id = $1
            ORDER BY created_at, id
            "#,
            session_id.to_string(),
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                let message = serde_json::from_value(row.message)?;
                Ok(PendingMessage {
                    id: row.id,
                    message,
                })
            })
            .collect()
    }

    async fn delete(&self, id: Uuid) -> anyhow::Result<()> {
        sqlx::query!(
            r#"
            DELETE FROM agent_proxy_pending_message
            WHERE id = $1
            "#,
            id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
