//! Session-owned runtime reconciliation reads.
use crate::domain::{model::AgentSessionId, ports::RuntimeSessionLookup};
use agent_client_protocol::schema::v1::SessionId;
use bot_id::BotId;

/// Postgres runtime session lookup.
#[derive(Clone)]
pub struct PgRuntimeSessions(pub sqlx::PgPool);

impl RuntimeSessionLookup for PgRuntimeSessions {
    type Err = sqlx::Error;

    async fn sessions_for_bots(
        &self,
        bots: &[BotId],
        sessions: &[SessionId],
    ) -> Result<Vec<AgentSessionId>, Self::Err> {
        let bots: Vec<_> = bots.iter().map(|bot| bot.as_uuid()).collect();
        let sessions: Vec<_> = sessions.iter().map(ToString::to_string).collect();
        let ids = sqlx::query_scalar!(
            "SELECT id FROM agent_session WHERE bot_id = ANY($1) AND acp_session_id = ANY($2)",
            &bots,
            &sessions,
        )
        .fetch_all(&self.0)
        .await?;
        Ok(ids.into_iter().map(AgentSessionId::new_from_uuid).collect())
    }
}
