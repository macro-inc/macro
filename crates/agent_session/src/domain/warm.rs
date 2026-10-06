//! Atomic promotion and expiry of unprompted, hidden warm sessions.

use super::{error::Result, model::AgentSessionId};
use bot_id::BotId;
use model_owner::Owner;
use std::future::Future;
use std::pin::Pin;

/// Persistence operations whose claim and expiry must serialize across replicas.
pub trait WarmSessionLifecycle: Send + Sync {
    /// Reveal only a fresh warm session belonging to this owner and exact persona.
    fn claim<'a>(
        &'a self,
        id: AgentSessionId,
        owner: &'a Owner,
        bot: BotId,
        model: &'a str,
        instructions: Option<&'a str>,
    ) -> Pin<Box<dyn Future<Output = Result<bool>> + Send + 'a>>;
    /// Mark expired hidden sessions disconnected, returning ids for routed deletion.
    /// Claimed sessions are never selected. Work is bounded per sweep.
    fn expire(&self) -> Pin<Box<dyn Future<Output = Result<Vec<AgentSessionId>>> + Send + '_>>;
}
