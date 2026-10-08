//! Warm sessions use list_hidden without a thread; hidden mentions always have a thread.
use super::*;
use crate::domain::warm::WarmSessionLifecycle;
use std::{future::Future, pin::Pin};

impl<B: BotFacts + 'static> WarmSessionLifecycle for PgAgentSessionRepo<B> {
    fn claim<'a>(
        &'a self,
        id: AgentSessionId,
        owner: &'a Owner,
        bot: BotId,
        model: &'a str,
        instructions: Option<&'a str>,
    ) -> Pin<Box<dyn Future<Output = Result<bool>> + Send + 'a>> {
        Box::pin(async move {
            let user = session_owner_user(owner)?;
            let mut transaction = self.pool.begin().await.context("begin warm claim")?;
            let changed = sqlx::query!(
                r#"
                UPDATE agent_session SET list_hidden = false
                WHERE id = $1 AND owner_id = $2 AND bot_id = $3 AND model = $4
                  AND instructions IS NOT DISTINCT FROM $5
                  AND list_hidden AND thread_id IS NULL
                  AND status != 'disconnected'
                  AND NOT (status = 'event' AND status_event_name = 'disconnected')
                  AND created_at > NOW() - INTERVAL '10 minutes'
            "#,
                id.as_uuid(),
                user.as_ref(),
                bot.as_uuid(),
                model,
                instructions
            )
            .execute(&mut *transaction)
            .await
            .context("claim warm session")?
            .rows_affected()
                == 1;
            if changed {
                upsert_user_history(&mut transaction, user.as_ref(), &id.as_uuid())
                    .await
                    .context("record claimed warm session history")?;
            }
            transaction.commit().await.context("commit warm claim")?;
            Ok(changed)
        })
    }
    fn expire(&self) -> Pin<Box<dyn Future<Output = Result<Vec<AgentSessionId>>> + Send + '_>> {
        Box::pin(async move {
            // Mark under row locks before deleting: a concurrent claim cannot win
            // after this operation, and a crash leaves a retryable expired row.
            let rows = sqlx::query!(
                r#"
                UPDATE agent_session SET status = 'disconnected'
                WHERE id IN (
                    SELECT id FROM agent_session
                    WHERE list_hidden AND thread_id IS NULL
                      AND created_at <= NOW() - INTERVAL '10 minutes'
                    ORDER BY created_at LIMIT 64 FOR UPDATE SKIP LOCKED
                ) RETURNING id
            "#
            )
            .fetch_all(&self.pool)
            .await
            .context("expire warm sessions")?;
            let mut expired = Vec::new();
            for row in rows {
                let id = AgentSessionId::new_from_uuid(row.id);
                expired.push(id);
            }
            Ok(expired)
        })
    }
}
