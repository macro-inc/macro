//! PostgreSQL mechanics for the harness-owned conversation turn journal.

use agent_runtime_protocol::domain::action::AgentActionId;
use agent_session::domain::{error::Result, model::AgentSessionId};
use bot_id::BotId;
use macro_uuid::Uuid;
use sqlx::PgPool;

#[cfg(test)]
mod test;

use crate::domain::{
    conversation_turns::{
        ConversationLease, ConversationSettings, ConversationTurn, ConversationTurnState,
        ConversationTurnStatus, ConversationTurnStore,
    },
    model::{OpenSession, ReplyOutcome},
    queue::InFlightTurn,
};

/// A journal independent of the ephemeral runtime and working command queue.
#[derive(Clone)]
pub struct PgConversationTurnStore {
    pool: PgPool,
    /// Pooled connections a session bootstrap may hold for its whole open.
    delivery_slots: std::sync::Arc<tokio::sync::Semaphore>,
    /// Pooled connections held by admission and reply reconciliation, which
    /// last a few queries. Kept apart so a slow bootstrap never starves them.
    lease_slots: std::sync::Arc<tokio::sync::Semaphore>,
}

/// How long a lease waits for a pooled connection before reporting itself
/// unavailable. Holders release theirs within a few queries, or once a
/// bootstrap has opened its session.
const SLOT_WAIT: std::time::Duration = std::time::Duration::from_secs(10);

/// Wait for one of `slots`, leaving the rest of the pool to everything else.
async fn take_slot(
    slots: &std::sync::Arc<tokio::sync::Semaphore>,
) -> Option<tokio::sync::OwnedSemaphorePermit> {
    tokio::time::timeout(SLOT_WAIT, slots.clone().acquire_owned())
        .await
        .ok()?
        .ok()
}

struct PgReplyLease {
    _transaction: sqlx::Transaction<'static, sqlx::Postgres>,
    _slot: tokio::sync::OwnedSemaphorePermit,
}
impl ConversationLease for PgReplyLease {}

impl PgConversationTurnStore {
    /// Construct at the composition root from MacroDB.
    pub fn new(pool: PgPool) -> Self {
        let slots = (pool.options().get_max_connections() as usize / 4).clamp(1, 16);
        Self {
            pool,
            delivery_slots: std::sync::Arc::new(tokio::sync::Semaphore::new(slots)),
            lease_slots: std::sync::Arc::new(tokio::sync::Semaphore::new(slots)),
        }
    }
}

fn decode(value: serde_json::Value) -> Result<ConversationTurn> {
    serde_json::from_value(value)
        .map_err(anyhow::Error::from)
        .map_err(Into::into)
}

#[async_trait::async_trait]
impl ConversationTurnStore for PgConversationTurnStore {
    async fn claim_delivery(
        &self,
        session: AgentSessionId,
    ) -> Result<Option<Box<dyn ConversationLease>>> {
        let Some(slot) = take_slot(&self.delivery_slots).await else {
            return Ok(None);
        };
        let mut tx = self.pool.begin().await.map_err(anyhow::Error::from)?;
        let claimed = sqlx::query_scalar!(
            r#"SELECT pg_try_advisory_xact_lock(hashtextextended($1, 45)) AS "claimed!""#,
            session.to_string()
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(anyhow::Error::from)?;
        Ok(claimed.then(|| {
            Box::new(PgReplyLease {
                _transaction: tx,
                _slot: slot,
            }) as Box<dyn ConversationLease>
        }))
    }
    async fn claim_context(
        &self,
        session: AgentSessionId,
    ) -> Result<Option<Box<dyn ConversationLease>>> {
        let Some(slot) = take_slot(&self.lease_slots).await else {
            return Ok(None);
        };
        let mut tx = self.pool.begin().await.map_err(anyhow::Error::from)?;
        let claimed = sqlx::query_scalar!(
            r#"SELECT pg_try_advisory_xact_lock(hashtextextended($1, 43)) AS "claimed!""#,
            session.to_string()
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(anyhow::Error::from)?;
        Ok(claimed.then(|| {
            Box::new(PgReplyLease {
                _transaction: tx,
                _slot: slot,
            }) as Box<dyn ConversationLease>
        }))
    }

    async fn cancel_queued(&self, session: AgentSessionId) -> Result<()> {
        let outcome = serde_json::to_value(ReplyOutcome::Cancelled).map_err(anyhow::Error::from)?;
        sqlx::query!("UPDATE agent_conversation_turns SET state = 'stopped', outcome = $2, updated_at = now() WHERE session_id = $1 AND state = 'queued'", session.as_uuid(), outcome)
            .execute(&self.pool).await.map_err(anyhow::Error::from)?;
        Ok(())
    }

    async fn settings(&self, session: AgentSessionId) -> Result<Option<ConversationSettings>> {
        sqlx::query_scalar!(
            "SELECT settings FROM agent_conversation_settings WHERE session_id = $1",
            session.as_uuid()
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(anyhow::Error::from)?
        .map(|value| {
            serde_json::from_value(value)
                .map_err(anyhow::Error::from)
                .map_err(Into::into)
        })
        .transpose()
    }

    async fn pin_settings(
        &self,
        session: AgentSessionId,
        settings: ConversationSettings,
    ) -> Result<ConversationSettings> {
        let settings = serde_json::to_value(settings).map_err(anyhow::Error::from)?;
        let value = sqlx::query_scalar!("INSERT INTO agent_conversation_settings AS original (session_id, settings) VALUES ($1, $2) ON CONFLICT (session_id) DO UPDATE SET session_id = original.session_id RETURNING settings", session.as_uuid(), settings)
            .fetch_one(&self.pool).await.map_err(anyhow::Error::from)?;
        serde_json::from_value(value)
            .map_err(anyhow::Error::from)
            .map_err(Into::into)
    }

    async fn admit(
        &self,
        session: AgentSessionId,
        channel: Uuid,
        command: OpenSession,
    ) -> Result<ConversationTurn> {
        let source = command.origin.announcement().message_id;
        let bot = command.bot_id;
        // A replay keeps the first admission's action id; this one is unused then.
        let action = AgentActionId::mint();
        let payload = serde_json::to_value(command).map_err(anyhow::Error::from)?;
        let value = sqlx::query_scalar!(
            r#"INSERT INTO agent_conversation_turns AS turn (source_message_id, bot_id, session_id, channel_id, action_id, command)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (source_message_id, bot_id) DO UPDATE SET source_message_id = turn.source_message_id
               RETURNING to_jsonb(turn) AS "value!""#,
            source, bot.as_uuid(), session.as_uuid(), channel, action.as_uuid(), payload
        ).fetch_one(&self.pool).await.map_err(anyhow::Error::from)?;
        decode(value)
    }

    async fn get(&self, source: Uuid, bot: BotId) -> Result<Option<ConversationTurn>> {
        sqlx::query_scalar!(r#"SELECT to_jsonb(j) AS "value!" FROM agent_conversation_turns j WHERE source_message_id = $1 AND bot_id = $2"#, source, bot.as_uuid())
            .fetch_optional(&self.pool).await.map_err(anyhow::Error::from)?.map(decode).transpose()
    }

    async fn claim(&self, action: AgentActionId, turn: &InFlightTurn) -> Result<bool> {
        let flight = serde_json::to_value(turn).map_err(anyhow::Error::from)?;
        let mut tx = self.pool.begin().await.map_err(anyhow::Error::from)?;
        // Serialize claims for the conversation's whole session, including two
        // different source messages received by different replicas at once.
        sqlx::query!("SELECT pg_advisory_xact_lock(hashtextextended(session_id::text, 43)) FROM agent_conversation_turns WHERE action_id = $1", action.as_uuid())
            .execute(&mut *tx).await.map_err(anyhow::Error::from)?;
        let claimed = sqlx::query!(
            "UPDATE agent_conversation_turns AS candidate SET state = 'running', in_flight = $2, updated_at = now() WHERE action_id = $1 AND state = 'queued' AND NOT EXISTS (SELECT 1 FROM agent_conversation_turns other WHERE other.session_id = candidate.session_id AND (other.state IN ('running', 'interrupted') OR (other.state = 'queued' AND (other.created_at, other.source_message_id) < (candidate.created_at, candidate.source_message_id))))",
            action.as_uuid(), flight
        ).execute(&mut *tx).await.map_err(anyhow::Error::from)?.rows_affected() == 1;
        tx.commit().await.map_err(anyhow::Error::from)?;
        Ok(claimed)
    }

    async fn retry(&self, source: Uuid, bot: BotId, expected: AgentActionId) -> Result<bool> {
        let action = AgentActionId::mint();
        Ok(sqlx::query!("UPDATE agent_conversation_turns SET action_id = $4, state = 'queued', in_flight = NULL, outcome = NULL, reply_segments = NULL, reply_finalized = FALSE, updated_at = now() WHERE source_message_id = $1 AND bot_id = $2 AND action_id = $3 AND state IN ('failed', 'stopped', 'interrupted') AND (reply_finalized OR in_flight->>'announcement_message_id' IS NULL)", source, bot.as_uuid(), expected.as_uuid(), action.as_uuid())
            .execute(&self.pool).await.map_err(anyhow::Error::from)?.rows_affected() == 1)
    }

    async fn by_action(&self, action: AgentActionId) -> Result<Option<ConversationTurn>> {
        sqlx::query_scalar!(
            r#"SELECT to_jsonb(j) AS "value!" FROM agent_conversation_turns j WHERE action_id = $1"#,
            action.as_uuid()
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(anyhow::Error::from)?
        .map(decode)
        .transpose()
    }

    async fn record_flight(&self, action: AgentActionId, turn: &InFlightTurn) -> Result<()> {
        let flight = serde_json::to_value(turn).map_err(anyhow::Error::from)?;
        sqlx::query!("UPDATE agent_conversation_turns SET in_flight = $2, updated_at = now() WHERE action_id = $1 AND state = 'running'", action.as_uuid(), flight)
            .execute(&self.pool).await.map_err(anyhow::Error::from)?;
        Ok(())
    }

    async fn save_reply(
        &self,
        action: AgentActionId,
        segments: &[agent_fold::domain::model::ProjectedSegment],
    ) -> Result<()> {
        let segments = serde_json::to_value(segments).map_err(anyhow::Error::from)?;
        sqlx::query!(
            "UPDATE agent_conversation_turns SET reply_segments = $2 WHERE action_id = $1",
            action.as_uuid(),
            segments
        )
        .execute(&self.pool)
        .await
        .map_err(anyhow::Error::from)?;
        Ok(())
    }

    async fn finish(
        &self,
        action: AgentActionId,
        state: ConversationTurnState,
        outcome: ReplyOutcome,
    ) -> Result<()> {
        let state = serde_json::to_value(state).map_err(anyhow::Error::from)?;
        let state = state.as_str().expect("turn states serialize as strings");
        let outcome = serde_json::to_value(outcome).map_err(anyhow::Error::from)?;
        sqlx::query!(
            "UPDATE agent_conversation_turns SET state = $2, outcome = $3, reply_finalized = FALSE, updated_at = now() WHERE action_id = $1 AND (state IN ('queued', 'running') OR (state = 'interrupted' AND $2 != 'interrupted'))",
            action.as_uuid(), state, outcome
        ).execute(&self.pool).await.map_err(anyhow::Error::from)?;
        Ok(())
    }

    async fn finalize_reply(&self, action: AgentActionId, outcome: &ReplyOutcome) -> Result<()> {
        let outcome = serde_json::to_value(outcome).map_err(anyhow::Error::from)?;
        sqlx::query!("UPDATE agent_conversation_turns SET reply_finalized = TRUE, updated_at = now() WHERE action_id = $1 AND outcome = $2", action.as_uuid(), outcome)
            .execute(&self.pool).await.map_err(anyhow::Error::from)?;
        Ok(())
    }

    async fn claim_reply(
        &self,
        action: AgentActionId,
    ) -> Result<Option<Box<dyn ConversationLease>>> {
        // Leave pool capacity for the message service while a reply lock is held.
        let Some(slot) = take_slot(&self.lease_slots).await else {
            return Ok(None);
        };
        let mut tx = self.pool.begin().await.map_err(anyhow::Error::from)?;
        let claimed = sqlx::query_scalar!(
            r#"SELECT pg_try_advisory_xact_lock(hashtextextended($1, 44)) AS "claimed!""#,
            action.to_string()
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(anyhow::Error::from)?;
        if !claimed {
            return Ok(None);
        }
        Ok(Some(Box::new(PgReplyLease {
            _transaction: tx,
            _slot: slot,
        })))
    }

    async fn pending(&self, limit: u16) -> Result<Vec<ConversationTurn>> {
        sqlx::query_scalar!(r#"SELECT to_jsonb(j) AS "value!" FROM agent_conversation_turns j WHERE state = 'queued' AND NOT EXISTS (SELECT 1 FROM agent_conversation_turns blocked WHERE blocked.session_id = j.session_id AND blocked.state = 'interrupted') ORDER BY created_at, source_message_id LIMIT $1"#, i64::from(limit))
            .fetch_all(&self.pool).await.map_err(anyhow::Error::from)?.into_iter().map(decode).collect()
    }

    async fn running(&self, limit: u16) -> Result<Vec<ConversationTurn>> {
        sqlx::query_scalar!(r#"SELECT to_jsonb(j) AS "value!" FROM agent_conversation_turns j WHERE state = 'running' AND updated_at < now() - interval '2 minutes' ORDER BY updated_at LIMIT $1"#, i64::from(limit))
            .fetch_all(&self.pool).await.map_err(anyhow::Error::from)?.into_iter().map(decode).collect()
    }

    async fn for_conversation(
        &self,
        channel: Uuid,
        bot: BotId,
    ) -> Result<Vec<ConversationTurnStatus>> {
        sqlx::query_scalar!(r#"SELECT jsonb_build_object('source_message_id', source_message_id, 'bot_id', bot_id, 'session_id', session_id, 'action_id', action_id, 'reply_message_id', in_flight->'announcement_message_id', 'state', state, 'created_at', created_at) AS "value!" FROM agent_conversation_turns WHERE channel_id = $1 AND bot_id = $2 ORDER BY created_at, source_message_id"#, channel, bot.as_uuid())
            .fetch_all(&self.pool).await.map_err(anyhow::Error::from)?.into_iter()
            .map(|value| serde_json::from_value(value).map_err(anyhow::Error::from).map_err(Into::into)).collect()
    }

    async fn pending_replies(&self, limit: u16) -> Result<Vec<ConversationTurn>> {
        sqlx::query_scalar!(r#"SELECT to_jsonb(j) AS "value!" FROM agent_conversation_turns j WHERE outcome IS NOT NULL AND NOT reply_finalized ORDER BY updated_at LIMIT $1"#, i64::from(limit))
            .fetch_all(&self.pool).await.map_err(anyhow::Error::from)?.into_iter().map(decode).collect()
    }
}
