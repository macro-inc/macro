//! PostgreSQL persistence for external-runtime thread replies.

use std::sync::Arc;

use agent_runtime_protocol::domain::action::AgentActionId;
use agent_session::domain::{error::Result, model::AgentSessionId};
use sqlx::PgPool;

use crate::domain::external_replies::{
    ExternalReply, ExternalReplyCompletion, ExternalReplyLease, ExternalReplyStore,
    ExternalReplyTarget,
};

/// Durable join of independently delivered announcements and turn completions.
pub struct PgExternalReplyStore {
    pool: PgPool,
    slots: Arc<tokio::sync::Semaphore>,
}

impl PgExternalReplyStore {
    /// Leave pool capacity available for the message service while holding leases.
    pub fn new(pool: PgPool) -> Self {
        let slots = (pool.options().get_max_connections() as usize / 4).clamp(1, 16);
        Self {
            pool,
            slots: Arc::new(tokio::sync::Semaphore::new(slots)),
        }
    }
}

struct ReplyLease {
    _transaction: sqlx::Transaction<'static, sqlx::Postgres>,
    _slot: tokio::sync::OwnedSemaphorePermit,
}
impl ExternalReplyLease for ReplyLease {}

fn decode(value: serde_json::Value) -> Result<ExternalReply> {
    serde_json::from_value(value)
        .map_err(anyhow::Error::from)
        .map_err(Into::into)
}

#[async_trait::async_trait]
impl ExternalReplyStore for PgExternalReplyStore {
    #[tracing::instrument(skip(self, target), err)]
    async fn reserve(
        &self,
        session: AgentSessionId,
        action: AgentActionId,
        target: &ExternalReplyTarget,
    ) -> Result<()> {
        let target = serde_json::to_value(target).map_err(anyhow::Error::from)?;
        sqlx::query!("INSERT INTO agent_external_replies (session_id, action_id, target) VALUES ($1, $2, $3) ON CONFLICT (session_id, action_id) DO UPDATE SET target = COALESCE(agent_external_replies.target, EXCLUDED.target), updated_at = now()", session.as_uuid(), action.as_uuid(), target)
            .execute(&self.pool).await.map_err(anyhow::Error::from)?;
        Ok(())
    }

    #[tracing::instrument(skip(self, completion), err)]
    async fn complete(
        &self,
        session: AgentSessionId,
        action: AgentActionId,
        completion: &ExternalReplyCompletion,
    ) -> Result<()> {
        let completion = serde_json::to_value(completion).map_err(anyhow::Error::from)?;
        sqlx::query!("INSERT INTO agent_external_replies (session_id, action_id, completion) VALUES ($1, $2, $3) ON CONFLICT (session_id, action_id) DO UPDATE SET completion = COALESCE(agent_external_replies.completion, EXCLUDED.completion), updated_at = now()", session.as_uuid(), action.as_uuid(), completion)
            .execute(&self.pool).await.map_err(anyhow::Error::from)?;
        Ok(())
    }

    async fn get(
        &self,
        session: AgentSessionId,
        action: AgentActionId,
    ) -> Result<Option<ExternalReply>> {
        sqlx::query_scalar!(r#"SELECT to_jsonb(reply) AS "value!" FROM agent_external_replies reply WHERE session_id = $1 AND action_id = $2"#, session.as_uuid(), action.as_uuid())
            .fetch_optional(&self.pool).await.map_err(anyhow::Error::from)?.map(decode).transpose()
    }

    async fn claim(
        &self,
        session: AgentSessionId,
        action: AgentActionId,
    ) -> Result<Option<Box<dyn ExternalReplyLease>>> {
        let Ok(slot) = self.slots.clone().try_acquire_owned() else {
            return Ok(None);
        };
        let mut tx = self.pool.begin().await.map_err(anyhow::Error::from)?;
        let key = format!("{session}:{action}");
        let claimed = sqlx::query_scalar!(
            r#"SELECT pg_try_advisory_xact_lock(hashtextextended($1, 48)) AS "claimed!""#,
            key
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(anyhow::Error::from)?;
        if !claimed {
            return Ok(None);
        }
        // Rotate every attempt, including failures, so a bad origin cannot
        // monopolize the bounded recovery batch.
        sqlx::query!("UPDATE agent_external_replies SET updated_at = now() WHERE session_id = $1 AND action_id = $2", session.as_uuid(), action.as_uuid())
            .execute(&self.pool).await.map_err(anyhow::Error::from)?;
        Ok(Some(Box::new(ReplyLease {
            _transaction: tx,
            _slot: slot,
        })))
    }

    async fn mark_announced(&self, session: AgentSessionId, action: AgentActionId) -> Result<()> {
        sqlx::query!("UPDATE agent_external_replies SET announced = TRUE WHERE session_id = $1 AND action_id = $2", session.as_uuid(), action.as_uuid())
            .execute(&self.pool).await.map_err(anyhow::Error::from)?;
        Ok(())
    }

    async fn finalize(&self, session: AgentSessionId, action: AgentActionId) -> Result<()> {
        sqlx::query!("UPDATE agent_external_replies SET finalized = TRUE, updated_at = now() WHERE session_id = $1 AND action_id = $2 AND target IS NOT NULL", session.as_uuid(), action.as_uuid())
            .execute(&self.pool).await.map_err(anyhow::Error::from)?;
        Ok(())
    }

    async fn pending(&self, limit: u16) -> Result<Vec<ExternalReply>> {
        // Keep old unmatched replies recoverable, but don't rescan their logs
        // every tick. A newly persisted completion bypasses this backoff.
        sqlx::query_scalar!(r#"SELECT to_jsonb(reply) AS "value!" FROM agent_external_replies reply WHERE target IS NOT NULL AND NOT finalized AND (completion IS NOT NULL OR created_at > now() - interval '24 hours' OR updated_at <= now() - interval '1 hour') ORDER BY updated_at, session_id, action_id LIMIT $1"#, i64::from(limit))
            .fetch_all(&self.pool).await.map_err(anyhow::Error::from)?.into_iter().map(decode).collect()
    }
}

#[cfg(test)]
mod test;
