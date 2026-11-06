//! What counts as activity on an agent session.
//!
//! A person starting a session is their own work, which is where Home's work
//! feed and every other own-work list read it. Recording it from `opened`,
//! published once the session's row and grants commit and before its sandbox
//! boots, puts the session in those lists while the sandbox is still starting.

#[cfg(test)]
mod test;

use ::activity::{Activity, ActivitySource, Actor, CommonAction, EntityType, Ingest, event_time};
use uuid::Uuid;

use super::{events::AgentSessionLifecycleEvent, model::SessionSource};

impl ActivitySource for AgentSessionLifecycleEvent {
    /// Maps one `macro.agent_session_lifecycle` event to its ingest outcome.
    ///
    /// Exhaustive on purpose: a new event variant fails compilation here
    /// until someone classifies it or explicitly drops it.
    fn ingest(&self, event_id: Uuid) -> Ingest {
        match self {
            // Another agent or a routine started it: nobody did this work.
            Self::Opened(metadata) => match metadata.identity.source {
                SessionSource::User => Ingest::Insert(vec![Activity::common(
                    event_id,
                    0,
                    Actor::new_from_user(metadata.identity.owner_id.clone()),
                    None,
                    EntityType::AgentSession,
                    metadata.identity.session_id.to_string(),
                    CommonAction::Created,
                    event_time(event_id),
                )]),
                SessionSource::Agent | SessionSource::Routine => Ingest::Ignore,
            },
            // Deleting a session removes its row.
            Self::Deleted(metadata) => Ingest::Purge(vec![(
                EntityType::AgentSession,
                metadata.identity.session_id.to_string(),
            )]),
            // Turns and their outcomes are the agent's work, not the viewer's.
            Self::TurnStarted(_)
            | Self::TurnEnded(_)
            | Self::CommandRejected(_)
            | Self::Settled(_)
            | Self::WaitingForInput(_)
            | Self::InputReceived(_)
            | Self::Mentioned(_)
            | Self::Stopped(_)
            | Self::Renamed(_) => Ingest::Ignore,
        }
    }
}
