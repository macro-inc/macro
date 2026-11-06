//! Postgres adapters for harness-keyed runtime routing.
//!
//! Composition-root adapters: [`PgHarnessBindings`] answers "which registered
//! harness serves this bot right now" for session binding, and
//! [`PgHarnessPresence`] writes the attach/detach bookkeeping the harness
//! settings page reads connection state from.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use agent_client_protocol::schema::v1::SessionId;
use agent_harness::domain::ports::{HarnessBindings, HarnessPresence};
use agent_session::domain::model::AgentSessionId;
use bot_id::BotId;
use harness_id::HarnessId;
use sqlx::PgPool;

#[cfg(test)]
mod test;

/// [`HarnessBindings`] over the `agent_configs` table.
#[derive(Clone)]
pub struct PgHarnessBindings {
    pool: PgPool,
}

impl PgHarnessBindings {
    /// Wrap a pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl HarnessBindings for PgHarnessBindings {
    async fn harness_for(&self, bot: BotId) -> anyhow::Result<Option<HarnessId>> {
        use bots::domain::ports::HarnessAssignments;
        use harnesses::domain::ports::HarnessRepo;

        let assignment = bots::outbound::pg_bots_repo::PgBotsRepo::new(self.pool.clone());
        let Some(harness) = assignment.harness_for(bot).await? else {
            return Ok(None);
        };
        let repo = harnesses::outbound::pg_harness_repo::PgHarnessRepo::new(self.pool.clone());
        Ok(repo.get_harness(harness).await?.map(|harness| harness.id))
    }

    async fn sessions_on_harness(
        &self,
        harness: HarnessId,
        acp_sessions: &[SessionId],
    ) -> anyhow::Result<Vec<AgentSessionId>> {
        use agent_session::domain::ports::RuntimeSessionLookup;
        use bots::domain::ports::HarnessAssignments;
        use harnesses::domain::ports::HarnessRepo;

        let repo = harnesses::outbound::pg_harness_repo::PgHarnessRepo::new(self.pool.clone());
        if repo.get_harness(harness).await?.is_none() {
            return Ok(Vec::new());
        }
        let assignments = bots::outbound::pg_bots_repo::PgBotsRepo::new(self.pool.clone());
        let bots = assignments.bots_on_harness(harness).await?;
        let sessions =
            agent_session::outbound::runtime_sessions::PgRuntimeSessions(self.pool.clone());
        Ok(sessions.sessions_for_bots(&bots, acp_sessions).await?)
    }
}

/// [`HarnessPresence`] over the `harnesses` table.
pub struct PgHarnessPresence {
    pool: PgPool,
}

impl PgHarnessPresence {
    /// Wrap a pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl HarnessPresence for PgHarnessPresence {
    fn connected(self: Arc<Self>, harness: HarnessId) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        Box::pin(async move {
            let result = sqlx::query!(
                r#"UPDATE harnesses SET last_connected_at = now() WHERE id = $1"#,
                harness.as_uuid(),
            )
            .execute(&self.pool)
            .await;
            if let Err(error) = result {
                tracing::error!(error = ?error, %harness, "failed to record harness attach");
            }
        })
    }

    fn disconnected(
        self: Arc<Self>,
        harness: HarnessId,
    ) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        Box::pin(async move {
            let result = sqlx::query!(
                r#"UPDATE harnesses SET last_disconnected_at = now() WHERE id = $1"#,
                harness.as_uuid(),
            )
            .execute(&self.pool)
            .await;
            if let Err(error) = result {
                tracing::error!(error = ?error, %harness, "failed to record harness detach");
            }
        })
    }
}
