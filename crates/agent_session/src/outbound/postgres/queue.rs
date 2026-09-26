//! Durable waiting actions for a session.

use super::*;
use crate::domain::model::StoredQueuedAction;
use sqlx::types::Json;

impl PgAgentSessionRepo {
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
    ) -> Result<()> {
        if entries.is_empty() {
            sqlx::query!(
                r#"
                DELETE FROM agent_session_queue
                WHERE agent_session_id = $1
                "#,
                id.as_uuid(),
            )
            .execute(&self.pool)
            .await
            .context("clear agent session queue")?;
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
        .execute(&self.pool)
        .await
        .context("replace agent session queue")?;
        Ok(())
    }
}
