//! Paused thread replies: a row in `agent_session_thread_reply_pause` while
//! a session answers only mentions.

use super::*;
use crate::domain::thread_replies::{ThreadRepliesRepo, ThreadRepliesState};

impl<B: BotFacts + 'static> ThreadRepliesRepo for PgAgentSessionRepo<B> {
    async fn thread_replies(&self, session: AgentSessionId) -> Result<ThreadRepliesState> {
        let row = sqlx::query!(
            r#"
            SELECT
                session.thread_id IS NOT NULL AS "from_thread!",
                EXISTS (
                    SELECT 1 FROM agent_session_thread_reply_pause pause
                    WHERE pause.session_id = session.id
                ) AS "paused!"
            FROM agent_session session
            WHERE session.id = $1
            "#,
            session.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await
        .context("read session thread replies")?
        .ok_or(AgentSessionError::NotFound(session))?;
        Ok(ThreadRepliesState {
            from_thread: row.from_thread,
            paused: row.paused,
        })
    }

    async fn set_thread_replies_paused(
        &self,
        session: AgentSessionId,
        by: Option<&MacroUserIdStr<'static>>,
    ) -> Result<()> {
        match by {
            Some(user) => {
                sqlx::query!(
                    r#"
                    INSERT INTO agent_session_thread_reply_pause (session_id, paused_by)
                    VALUES ($1, $2)
                    ON CONFLICT (session_id) DO NOTHING
                    "#,
                    session.as_uuid(),
                    user.as_ref(),
                )
                .execute(&self.pool)
                .await
                .context("pause session thread replies")?;
            }
            None => {
                sqlx::query!(
                    "DELETE FROM agent_session_thread_reply_pause WHERE session_id = $1",
                    session.as_uuid(),
                )
                .execute(&self.pool)
                .await
                .context("resume session thread replies")?;
            }
        }
        Ok(())
    }
}
