//! Durable waiting actions for a session.

use super::*;
use crate::domain::model::StoredQueuedAction;
use sqlx::types::Json;

impl<B> PgAgentSessionRepo<B> {
    pub(super) async fn load_queued_actions(
        &self,
        id: AgentSessionId,
    ) -> Result<Vec<StoredQueuedAction>> {
        let row = sqlx::query!(
            r#"
            SELECT entries AS "entries: Json<Vec<StoredQueuedAction>>"
            FROM agent_session_queue
            WHERE agent_session_id = $1
            "#,
            id.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await
        .context("list agent session queue")?;
        Ok(row.map(|row| row.entries.0).unwrap_or_default())
    }

    pub(super) async fn store_queued_actions(
        &self,
        id: AgentSessionId,
        entries: &[StoredQueuedAction],
        cancelled: Option<agent_runtime_protocol::domain::action::AgentActionId>,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await.context("begin queue mutation")?;
        if let Some(action) = cancelled {
            sqlx::query!("INSERT INTO agent_session_cancelled_action (agent_session_id, action_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", id.as_uuid(), action.as_uuid()).execute(&mut *tx).await.context("record explicit queue cancellation")?;
        }
        if entries.is_empty() {
            sqlx::query!(
                r#"
                DELETE FROM agent_session_queue
                WHERE agent_session_id = $1
                "#,
                id.as_uuid(),
            )
            .execute(&mut *tx)
            .await
            .context("clear agent session queue")?;
            tx.commit().await.context("commit queue cancellation")?;
            return Ok(());
        }

        sqlx::query!(
            r#"
            INSERT INTO agent_session_queue (agent_session_id, entries)
            VALUES ($1, $2)
            ON CONFLICT (agent_session_id) DO UPDATE SET
                entries = EXCLUDED.entries,
                updated_at = now()
            "#,
            id.as_uuid(),
            Json(entries) as _,
        )
        .execute(&mut *tx)
        .await
        .context("replace agent session queue")?;
        tx.commit().await.context("commit queue mutation")?;
        Ok(())
    }
}
