//! The agent teammates rollout for an agent account.
//!
//! PostHog targets people (for example by email domain), and an agent's own
//! `@agents.macro.invalid` account never matches. So an agent's rollout is
//! its team's rollout as seen by the person who invited it: every surface an
//! agent itself calls (its enrollment, git, model and speech gateways, MCP
//! keys) evaluates [`AGENT_TEAMMATES_FLAG`] for the agent's creator
//! (`team_agents.created_by`), through [`agent_teammates_enabled`].
//!
//! Fails closed: no flag provider, no `team_agents` row, a creator whose
//! account was deleted (`created_by` is cleared), or a failed lookup or load
//! all mean off. A creator who later leaves the team still decides: the flag
//! is a rollout gate, not authorization, and a team stops an agent by
//! removing it.

use std::collections::HashMap;
use std::future::Future;

use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;

use crate::AGENT_TEAMMATES_FLAG;

#[cfg(feature = "postgres")]
mod postgres;
#[cfg(test)]
mod test;

#[cfg(feature = "postgres")]
pub use postgres::PgAgentCreators;

/// Who invited each agent teammate.
pub trait AgentCreators: Send + Sync {
    /// The person who invited `agent`. `None` when the account is no agent
    /// teammate, or its creator's account is gone.
    fn creator_of(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<MacroUserIdStr<'static>>, Report>> + Send;
}

/// Whether agent teammates are on for `agent`: the flag as its creator sees
/// it. See the [module docs](self).
pub async fn agent_teammates_enabled<Creators: AgentCreators, Flags: FeatureFlags>(
    creators: &Creators,
    flags: Option<&Flags>,
    agent: &MacroUserIdStr<'_>,
) -> bool {
    let Some(flags) = flags else {
        return false;
    };

    let creator = match creators.creator_of(agent).await {
        Ok(Some(creator)) => creator,
        Ok(None) => {
            tracing::warn!("this agent has no creator; agent teammates are off for it");
            return false;
        }
        Err(error) => {
            tracing::warn!(
                ?error,
                "could not read this agent's creator; agent teammates are off for it"
            );
            return false;
        }
    };

    match flags.load(&creator).await {
        Ok(snapshot) => snapshot.is_enabled(AGENT_TEAMMATES_FLAG),
        Err(error) => {
            tracing::warn!(
                ?error,
                "could not load the feature flags of this agent's creator; agent teammates are off for it"
            );
            false
        }
    }
}

/// An in-memory [`AgentCreators`] for tests. Agents without a creator set
/// have none.
#[derive(Clone, Default)]
pub struct FakeAgentCreators {
    creators: HashMap<MacroUserIdStr<'static>, MacroUserIdStr<'static>>,
}

impl FakeAgentCreators {
    /// Record that `creator` invited `agent`.
    pub fn set(&mut self, agent: MacroUserIdStr<'static>, creator: MacroUserIdStr<'static>) {
        self.creators.insert(agent, creator);
    }
}

impl AgentCreators for FakeAgentCreators {
    async fn creator_of(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<Option<MacroUserIdStr<'static>>, Report> {
        Ok(self.creators.get(agent).cloned())
    }
}
