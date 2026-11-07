use super::*;
use crate::domain::list_visibility::SessionListVisibilityRepo;

impl<B: BotFacts + 'static> SessionListVisibilityRepo for PgAgentSessionRepo<B> {
    async fn hide_dm_sessions(&self, limit: u16) -> Result<u64> {
        let result = sqlx::query!(
            r#"
            UPDATE agent_session SET visibility = 'hidden', for_warming = FALSE
            WHERE id IN (
                SELECT s.id FROM agent_session s
                JOIN agent_conversation_sessions c ON c.session_id = s.id
                JOIN comms_channel_agents a ON a.channel_id = c.channel_id
                    AND a.bot_id = c.bot_id AND a.kind = 'direct'
                WHERE s.visibility <> 'hidden' OR s.for_warming
                ORDER BY s.id LIMIT $1 FOR UPDATE OF s SKIP LOCKED
            )
            "#,
            i64::from(limit),
        )
        .execute(&self.pool)
        .await
        .context("hide existing agent DM contexts")?;
        Ok(result.rows_affected())
    }
}
