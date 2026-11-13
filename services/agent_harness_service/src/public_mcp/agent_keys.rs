//! The public MCP's user API key path, for agent teammates only: a key is
//! accepted only when its owner has a `team_agents` row and
//! `enable-agent-teammates` is on for the person who invited it, as the brain
//! checks.
//! Every other key holder signs in with a JWT or a Macro API token.

use std::{future::Future, pin::Pin, sync::Arc};

use macro_user_id::user_id::MacroUserIdStr;
use mcp_auth_proxy::domain::user_api_keys::McpUserApiKeys;
use sqlx::PgPool;

use crate::anthropic_gateway::brain::BrainRollout;

#[cfg(test)]
mod test;

type IsAgent =
    dyn Fn(MacroUserIdStr<'static>) -> Pin<Box<dyn Future<Output = bool> + Send>> + Send + Sync;

/// User API keys of agent teammates with the rollout on.
pub(crate) struct AgentUserApiKeys<Keys> {
    keys: Keys,
    is_agent: Arc<IsAgent>,
    rollout: BrainRollout,
}

impl<Keys> AgentUserApiKeys<Keys> {
    /// Agents are accounts with a `team_agents` row. A failed lookup refuses.
    pub(crate) fn new(keys: Keys, pool: PgPool, rollout: BrainRollout) -> Self {
        Self::with_lookup(
            keys,
            Arc::new(move |user| {
                let pool = pool.clone();
                Box::pin(async move {
                    sqlx::query_scalar!(
                        r#"SELECT EXISTS (SELECT 1 FROM team_agents WHERE user_id = $1) AS "agent!""#,
                        user.as_ref(),
                    )
                    .fetch_one(&pool)
                    .await
                    .inspect_err(|error| {
                        tracing::warn!(?error, "agent lookup failed; refusing the user key");
                    })
                    .unwrap_or(false)
                })
            }),
            rollout,
        )
    }

    fn with_lookup(keys: Keys, is_agent: Arc<IsAgent>, rollout: BrainRollout) -> Self {
        Self {
            keys,
            is_agent,
            rollout,
        }
    }
}

impl<Keys: McpUserApiKeys> McpUserApiKeys for AgentUserApiKeys<Keys> {
    fn user<'a>(
        &'a self,
        key: &'a str,
    ) -> Pin<Box<dyn Future<Output = Option<MacroUserIdStr<'static>>> + Send + 'a>> {
        Box::pin(async move {
            let user = self.keys.user(key).await?;
            if !(self.is_agent)(user.clone()).await {
                return None;
            }
            if !self.rollout.enabled(&user).await {
                return None;
            }
            Some(user)
        })
    }
}
