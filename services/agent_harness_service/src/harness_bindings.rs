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
        let harness_id = sqlx::query_scalar!(
            r#"
            SELECT ac.harness_id
            FROM agent_configs ac
            JOIN harnesses h ON h.id = ac.harness_id
            WHERE ac.bot_id = $1 AND h.deleted_at IS NULL
            "#,
            bot.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(harness_id.flatten().map(HarnessId::new_from_uuid))
    }

    async fn sessions_on_harness(
        &self,
        harness: HarnessId,
        acp_sessions: &[SessionId],
    ) -> anyhow::Result<Vec<AgentSessionId>> {
        let acp_sessions: Vec<String> = acp_sessions
            .iter()
            .map(|session| session.to_string())
            .collect();
        let ids = sqlx::query_scalar!(
            r#"
            SELECT s.id
            FROM agent_session s
            JOIN agent_configs ac ON ac.bot_id = s.bot_id
            JOIN harnesses h ON h.id = ac.harness_id
            WHERE ac.harness_id = $1
              AND h.deleted_at IS NULL
              AND s.acp_session_id = ANY($2)
            "#,
            harness.as_uuid(),
            &acp_sessions,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(ids.into_iter().map(AgentSessionId::new_from_uuid).collect())
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
