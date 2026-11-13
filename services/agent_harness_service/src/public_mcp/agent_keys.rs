//! The public MCP's user API key path, for agent teammates only: a key is
//! accepted only when `enable-agent-teammates` is on for the person who
//! invited its owner, as the brain checks. That check finds the inviter from
//! the owner's `team_agents` row, so a key whose owner has none (any person)
//! is refused by it too. Every other key holder signs in with a JWT or a
//! Macro API token.

use std::{future::Future, pin::Pin};

use macro_user_id::user_id::MacroUserIdStr;
use mcp_auth_proxy::domain::user_api_keys::McpUserApiKeys;

use crate::anthropic_gateway::brain::BrainRollout;

#[cfg(test)]
mod test;

/// User API keys of agent teammates with the rollout on.
pub(crate) struct AgentUserApiKeys<Keys> {
    keys: Keys,
    rollout: BrainRollout,
}

impl<Keys> AgentUserApiKeys<Keys> {
    pub(crate) fn new(keys: Keys, rollout: BrainRollout) -> Self {
        Self { keys, rollout }
    }
}

impl<Keys: McpUserApiKeys> McpUserApiKeys for AgentUserApiKeys<Keys> {
    fn user<'a>(
        &'a self,
        key: &'a str,
    ) -> Pin<Box<dyn Future<Output = Option<MacroUserIdStr<'static>>> + Send + 'a>> {
        Box::pin(async move {
            let user = self.keys.user(key).await?;
            if !self.rollout.enabled(&user).await {
                return None;
            }
            Some(user)
        })
    }
}
