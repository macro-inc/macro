//! Atomic promotion and expiry of unprompted, hidden warm sessions.

use super::{error::Result, model::AgentSessionId};
use bot_id::BotId;
use model_owner::Owner;
use std::future::Future;
use std::pin::Pin;

/// What a claim found; a miss says the first claim condition that failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WarmClaim {
    Claimed,
    Missed(WarmMissReason),
}

/// Why a claim missed, in the order the claim checks them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum WarmMissReason {
    /// No session has this id: the client sent a fresh id, or the warm row is gone.
    NotFound,
    /// The session is visible or belongs to a thread.
    NotWarm,
    OwnerMismatch,
    BotMismatch,
    ModelMismatch,
    InstructionsMismatch,
    Disconnected,
    Expired,
    /// Every condition held, but a concurrent claim promoted it first.
    LostRace,
}

impl WarmClaim {
    /// Whether the id named a warm session at all.
    pub fn found_warm_session(self) -> bool {
        !matches!(
            self,
            Self::Missed(WarmMissReason::NotFound | WarmMissReason::NotWarm)
        )
    }
}

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
    ) -> Pin<Box<dyn Future<Output = Result<WarmClaim>> + Send + 'a>>;
    /// Mark expired hidden sessions disconnected, returning ids for routed deletion.
    /// Claimed sessions are never selected. Work is bounded per sweep.
    fn expire(&self) -> Pin<Box<dyn Future<Output = Result<Vec<AgentSessionId>>> + Send + '_>>;
}
