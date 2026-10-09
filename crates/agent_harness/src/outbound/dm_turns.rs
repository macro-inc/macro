//! PostgreSQL mechanics for the harness-owned DM execution journal.

use agent_runtime_protocol::domain::action::AgentActionId;
use agent_session::domain::{error::Result, model::AgentSessionId};
use macro_uuid::Uuid;
use sqlx::PgPool;

#[cfg(test)]
mod test;

use crate::domain::{
    dm_turns::{DmReplyLease, DmSessionSettings, DmTurn, DmTurnState, DmTurnStatus, DmTurnStore},
    model::{OpenSession, ReplyOutcome},
    queue::InFlightTurn,
};

/// A journal independent of the ephemeral runtime and working command queue.
#[derive(Clone)]
pub struct PgDmTurnStore {
    pool: PgPool,
    reply_slots: std::sync::Arc<tokio::sync::Semaphore>,
}

struct PgReplyLease {
    _transaction: sqlx::Transaction<'static, sqlx::Postgres>,
    _slot: tokio::sync::OwnedSemaphorePermit,
}
impl DmReplyLease for PgReplyLease {}

impl PgDmTurnStore {
    /// Construct at the composition root from MacroDB.
    pub fn new(pool: PgPool) -> Self {
        let slots = (pool.options().get_max_connections() as usize / 4).clamp(1, 16);
        Self {
            pool,
            reply_slots: std::sync::Arc::new(tokio::sync::Semaphore::new(slots)),
        }
    }
}

fn decode(value: serde_json::Value) -> Result<DmTurn> {
    serde_json::from_value(value)
        .map_err(anyhow::Error::from)
        .map_err(Into::into)
}

#[async_trait::async_trait]
impl DmTurnStore for PgDmTurnStore {
    async fn claim_delivery(
        &self,
        session: AgentSessionId,
    ) -> Result<Option<Box<dyn DmReplyLease>>> {
        let Ok(slot) = self.reply_slots.clone().try_acquire_owned() else {
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
            }) as Box<dyn DmReplyLease>
        }))
    }
    async fn claim_context(
        &self,
        session: AgentSessionId,
    ) -> Result<Option<Box<dyn DmReplyLease>>> {
        let Ok(slot) = self.reply_slots.clone().try_acquire_owned() else {
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
            }) as Box<dyn DmReplyLease>
        }))
    }

    async fn cancel_queued(&self, session: AgentSessionId) -> Result<()> {
        let outcome = serde_json::to_value(ReplyOutcome::Cancelled).map_err(anyhow::Error::from)?;
        sqlx::query!("UPDATE agent_dm_turn_journal SET state = 'stopped', outcome = $2, updated_at = now() WHERE session_id = $1 AND state = 'queued'", session.as_uuid(), outcome)
            .execute(&self.pool).await.map_err(anyhow::Error::from)?;
        Ok(())
    }

    async fn settings(&self, session: AgentSessionId) -> Result<Option<DmSessionSettings>> {
        sqlx::query_scalar!(
            "SELECT settings FROM agent_dm_settings WHERE session_id = $1",
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
        settings: DmSessionSettings,
    ) -> Result<DmSessionSettings> {
        let settings = serde_json::to_value(settings).map_err(anyhow::Error::from)?;
        let value = sqlx::query_scalar!("INSERT INTO agent_dm_settings AS original (session_id, settings) VALUES ($1, $2) ON CONFLICT (session_id) DO UPDATE SET session_id = original.session_id RETURNING settings", session.as_uuid(), settings)
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
    ) -> Result<DmTurn> {
        let source = command.origin.announcement().message_id;
        let payload = serde_json::to_value(command).map_err(anyhow::Error::from)?;
        let value = sqlx::query_scalar!(
            r#"INSERT INTO agent_dm_turn_journal AS journal (source_message_id, session_id, channel_id, action_id, command)
               VALUES ($1, $2, $3, $1, $4)
               ON CONFLICT (source_message_id) DO UPDATE SET source_message_id = journal.source_message_id
               RETURNING to_jsonb(journal) AS "value!""#,
            source, session.as_uuid(), channel, payload
        ).fetch_one(&self.pool).await.map_err(anyhow::Error::from)?;
        decode(value)
    }

    async fn get(&self, source: Uuid) -> Result<Option<DmTurn>> {
        sqlx::query_scalar!(r#"SELECT to_jsonb(j) AS "value!" FROM agent_dm_turn_journal j WHERE source_message_id = $1"#, source)
            .fetch_optional(&self.pool).await.map_err(anyhow::Error::from)?.map(decode).transpose()
    }

    async fn claim(&self, action: AgentActionId, turn: &InFlightTurn) -> Result<bool> {
        let flight = serde_json::to_value(turn).map_err(anyhow::Error::from)?;
        let mut tx = self.pool.begin().await.map_err(anyhow::Error::from)?;
        // Serialize claims for the whole conversation segment, including two
        // different source messages received by different replicas at once.
        sqlx::query!("SELECT pg_advisory_xact_lock(hashtextextended(session_id::text, 43)) FROM agent_dm_turn_journal WHERE action_id = $1", action.as_uuid())
            .execute(&mut *tx).await.map_err(anyhow::Error::from)?;
        let claimed = sqlx::query!(
            "UPDATE agent_dm_turn_journal AS candidate SET state = 'running', in_flight = $2, updated_at = now() WHERE action_id = $1 AND state = 'queued' AND NOT EXISTS (SELECT 1 FROM agent_dm_turn_journal other WHERE other.session_id = candidate.session_id AND (other.state IN ('running', 'interrupted') OR (other.state = 'queued' AND (other.created_at, other.source_message_id) < (candidate.created_at, candidate.source_message_id))))",
            action.as_uuid(), flight
        ).execute(&mut *tx).await.map_err(anyhow::Error::from)?.rows_affected() == 1;
        tx.commit().await.map_err(anyhow::Error::from)?;
        Ok(claimed)
    }

    async fn retry(&self, source: Uuid, expected: AgentActionId) -> Result<bool> {
        let action = AgentActionId::mint();
        Ok(sqlx::query!("UPDATE agent_dm_turn_journal SET action_id = $3, state = 'queued', in_flight = NULL, outcome = NULL, reply_finalized = FALSE, updated_at = now() WHERE source_message_id = $1 AND action_id = $2 AND state IN ('failed', 'stopped', 'interrupted') AND (reply_finalized OR in_flight->>'announcement_message_id' IS NULL)", source, expected.as_uuid(), action.as_uuid())
            .execute(&self.pool).await.map_err(anyhow::Error::from)?.rows_affected() == 1)
    }

    async fn by_action(&self, action: AgentActionId) -> Result<Option<DmTurn>> {
        sqlx::query_scalar!(
            r#"SELECT to_jsonb(j) AS "value!" FROM agent_dm_turn_journal j WHERE action_id = $1"#,
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
        sqlx::query!("UPDATE agent_dm_turn_journal SET in_flight = $2, updated_at = now() WHERE action_id = $1 AND state = 'running'", action.as_uuid(), flight)
            .execute(&self.pool).await.map_err(anyhow::Error::from)?;
        Ok(())
    }

    async fn finish(
        &self,
        action: AgentActionId,
        state: DmTurnState,
        outcome: ReplyOutcome,
    ) -> Result<()> {
        let state = serde_json::to_value(state).map_err(anyhow::Error::from)?;
        let state = state.as_str().expect("turn states serialize as strings");
        let outcome = serde_json::to_value(outcome).map_err(anyhow::Error::from)?;
        sqlx::query!(
            "UPDATE agent_dm_turn_journal SET state = $2, outcome = $3, reply_finalized = FALSE, updated_at = now() WHERE action_id = $1 AND (state IN ('queued', 'running') OR (state = 'interrupted' AND $2 != 'interrupted'))",
            action.as_uuid(), state, outcome
        ).execute(&self.pool).await.map_err(anyhow::Error::from)?;
        Ok(())
    }

    async fn finalize_reply(&self, action: AgentActionId, outcome: &ReplyOutcome) -> Result<()> {
        let outcome = serde_json::to_value(outcome).map_err(anyhow::Error::from)?;
        sqlx::query!("UPDATE agent_dm_turn_journal SET reply_finalized = TRUE, updated_at = now() WHERE action_id = $1 AND outcome = $2", action.as_uuid(), outcome)
            .execute(&self.pool).await.map_err(anyhow::Error::from)?;
        Ok(())
    }

    async fn claim_reply(&self, action: AgentActionId) -> Result<Option<Box<dyn DmReplyLease>>> {
        // Leave pool capacity for the message service while a reply lock is held.
        let Ok(slot) = self.reply_slots.clone().try_acquire_owned() else {
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

    async fn pending(&self, limit: u16) -> Result<Vec<DmTurn>> {
        sqlx::query_scalar!(r#"SELECT to_jsonb(j) AS "value!" FROM agent_dm_turn_journal j WHERE state = 'queued' AND NOT EXISTS (SELECT 1 FROM agent_dm_turn_journal blocked WHERE blocked.session_id = j.session_id AND blocked.state = 'interrupted') ORDER BY created_at, source_message_id LIMIT $1"#, i64::from(limit))
            .fetch_all(&self.pool).await.map_err(anyhow::Error::from)?.into_iter().map(decode).collect()
    }

    async fn running(&self, limit: u16) -> Result<Vec<DmTurn>> {
        sqlx::query_scalar!(r#"SELECT to_jsonb(j) AS "value!" FROM agent_dm_turn_journal j WHERE state = 'running' AND updated_at < now() - interval '2 minutes' ORDER BY updated_at LIMIT $1"#, i64::from(limit))
            .fetch_all(&self.pool).await.map_err(anyhow::Error::from)?.into_iter().map(decode).collect()
    }

    async fn for_channel(&self, channel: Uuid) -> Result<Vec<DmTurnStatus>> {
        sqlx::query_scalar!(r#"SELECT jsonb_build_object('source_message_id', source_message_id, 'session_id', session_id, 'action_id', action_id, 'reply_message_id', in_flight->'announcement_message_id', 'state', state, 'created_at', created_at) AS "value!" FROM agent_dm_turn_journal WHERE channel_id = $1 ORDER BY created_at, source_message_id"#, channel)
            .fetch_all(&self.pool).await.map_err(anyhow::Error::from)?.into_iter()
            .map(|value| serde_json::from_value(value).map_err(anyhow::Error::from).map_err(Into::into)).collect()
    }

    async fn pending_replies(&self, limit: u16) -> Result<Vec<DmTurn>> {
        sqlx::query_scalar!(r#"SELECT to_jsonb(j) AS "value!" FROM agent_dm_turn_journal j WHERE outcome IS NOT NULL AND NOT reply_finalized ORDER BY updated_at LIMIT $1"#, i64::from(limit))
            .fetch_all(&self.pool).await.map_err(anyhow::Error::from)?.into_iter().map(decode).collect()
    }
}
