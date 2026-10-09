//! Session reservations keep a DM stable across concurrent posts and restarts.

use super::*;
use crate::domain::agent_dm::{AgentDmConversationRepo, AgentDmSegment};

#[cfg(test)]
mod test;

impl<B: BotFacts + 'static> PgAgentSessionRepo<B> {
    async fn reserve_dm_session(&self, channel_id: Uuid, fresh: bool) -> Result<AgentSessionId> {
        let mut tx = self.pool.begin().await.map_err(anyhow::Error::from)?;
        let lock_key = format!("agent-dm-session:{channel_id}");
        sqlx::query!(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            lock_key
        )
        .execute(&mut *tx)
        .await
        .map_err(anyhow::Error::from)?;
        if fresh {
            sqlx::query!("UPDATE agent_dm_conversations SET is_current = FALSE WHERE channel_id = $1 AND is_current", channel_id)
                .execute(&mut *tx).await.map_err(anyhow::Error::from)?;
        }
        let current = sqlx::query_scalar!(
            "SELECT session_id FROM agent_dm_conversations WHERE channel_id = $1 AND is_current",
            channel_id
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(anyhow::Error::from)?;
        let session_id = current
            .map(AgentSessionId::new_from_uuid)
            .unwrap_or_else(AgentSessionId::new);
        if current.is_none() {
            sqlx::query!(
                "INSERT INTO agent_dm_conversations (session_id, channel_id) VALUES ($1, $2)",
                session_id.as_uuid(),
                channel_id
            )
            .execute(&mut *tx)
            .await
            .map_err(anyhow::Error::from)?;
        }
        tx.commit().await.map_err(anyhow::Error::from)?;
        Ok(session_id)
    }
}

impl<B: BotFacts + 'static> AgentDmConversationRepo for PgAgentSessionRepo<B> {
    async fn segments(&self, channel_id: Uuid) -> Result<Vec<AgentDmSegment>> {
        let rows = sqlx::query!(
            "SELECT session_id, created_at, is_current FROM agent_dm_conversations WHERE channel_id = $1 ORDER BY created_at, session_id",
            channel_id
        ).fetch_all(&self.pool).await.map_err(anyhow::Error::from)?;
        Ok(rows
            .into_iter()
            .map(|row| AgentDmSegment {
                session_id: AgentSessionId::new_from_uuid(row.session_id),
                created_at: row.created_at,
                is_current: row.is_current,
            })
            .collect())
    }

    async fn current_or_create(&self, channel_id: Uuid) -> Result<AgentSessionId> {
        self.reserve_dm_session(channel_id, false).await
    }

    async fn current(&self, channel_id: Uuid) -> Result<Option<AgentSessionId>> {
        Ok(sqlx::query_scalar!(
            "SELECT session_id FROM agent_dm_conversations WHERE channel_id = $1 AND is_current",
            channel_id
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(anyhow::Error::from)?
        .map(AgentSessionId::new_from_uuid))
    }

    async fn start_fresh(&self, channel_id: Uuid) -> Result<AgentSessionId> {
        self.reserve_dm_session(channel_id, true).await
    }

    async fn channel_for_session(&self, session_id: AgentSessionId) -> Result<Option<Uuid>> {
        Ok(sqlx::query_scalar!(
            "SELECT channel_id FROM agent_dm_conversations WHERE session_id = $1",
            session_id.as_uuid()
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(anyhow::Error::from)?)
    }
}
