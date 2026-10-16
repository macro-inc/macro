//! Session reservations keep a conversation stable across concurrent posts
//! and restarts.

use super::*;
use crate::domain::agent_conversation::{
    AgentConversation, AgentConversationRepo, ConversationSession,
};

#[cfg(test)]
mod test;

impl<B: BotFacts + 'static> PgAgentSessionRepo<B> {
    async fn reserve_conversation_session(
        &self,
        conversation: AgentConversation,
        fresh: bool,
    ) -> Result<AgentSessionId> {
        let AgentConversation { channel_id, bot_id } = conversation;
        let mut tx = self.pool.begin().await.map_err(anyhow::Error::from)?;
        let lock_key = format!("agent-conversation-session:{channel_id}:{bot_id}");
        sqlx::query!(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            lock_key
        )
        .execute(&mut *tx)
        .await
        .map_err(anyhow::Error::from)?;
        if fresh {
            sqlx::query!(
                "UPDATE agent_conversation_sessions SET is_current = FALSE WHERE channel_id = $1 AND bot_id = $2 AND is_current",
                channel_id,
                bot_id.as_uuid()
            )
            .execute(&mut *tx)
            .await
            .map_err(anyhow::Error::from)?;
        }
        let current = sqlx::query_scalar!(
            "SELECT session_id FROM agent_conversation_sessions WHERE channel_id = $1 AND bot_id = $2 AND is_current",
            channel_id,
            bot_id.as_uuid()
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(anyhow::Error::from)?;
        let session_id = current
            .map(AgentSessionId::new_from_uuid)
            .unwrap_or_else(AgentSessionId::new);
        if current.is_none() {
            sqlx::query!(
                "INSERT INTO agent_conversation_sessions (session_id, channel_id, bot_id) VALUES ($1, $2, $3)",
                session_id.as_uuid(),
                channel_id,
                bot_id.as_uuid()
            )
            .execute(&mut *tx)
            .await
            .map_err(anyhow::Error::from)?;
        }
        tx.commit().await.map_err(anyhow::Error::from)?;
        Ok(session_id)
    }
}

impl<B: BotFacts + 'static> AgentConversationRepo for PgAgentSessionRepo<B> {
    async fn sessions(&self, conversation: AgentConversation) -> Result<Vec<ConversationSession>> {
        let rows = sqlx::query!(
            "SELECT session_id, created_at, is_current FROM agent_conversation_sessions WHERE channel_id = $1 AND bot_id = $2 ORDER BY created_at, session_id",
            conversation.channel_id,
            conversation.bot_id.as_uuid()
        )
        .fetch_all(&self.pool)
        .await
        .map_err(anyhow::Error::from)?;
        Ok(rows
            .into_iter()
            .map(|row| ConversationSession {
                session_id: AgentSessionId::new_from_uuid(row.session_id),
                created_at: row.created_at,
                is_current: row.is_current,
            })
            .collect())
    }

    async fn current_or_create(&self, conversation: AgentConversation) -> Result<AgentSessionId> {
        self.reserve_conversation_session(conversation, false).await
    }

    async fn current(&self, conversation: AgentConversation) -> Result<Option<AgentSessionId>> {
        Ok(sqlx::query_scalar!(
            "SELECT session_id FROM agent_conversation_sessions WHERE channel_id = $1 AND bot_id = $2 AND is_current",
            conversation.channel_id,
            conversation.bot_id.as_uuid()
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(anyhow::Error::from)?
        .map(AgentSessionId::new_from_uuid))
    }

    async fn start_fresh(&self, conversation: AgentConversation) -> Result<AgentSessionId> {
        self.reserve_conversation_session(conversation, true).await
    }

    async fn conversation_for_session(
        &self,
        session_id: AgentSessionId,
    ) -> Result<Option<AgentConversation>> {
        Ok(sqlx::query!(
            "SELECT channel_id, bot_id FROM agent_conversation_sessions WHERE session_id = $1",
            session_id.as_uuid()
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(anyhow::Error::from)?
        .map(|row| AgentConversation {
            channel_id: row.channel_id,
            bot_id: BotId::new_from_uuid(row.bot_id),
        }))
    }
}
