//! Deterministic routing for a private user-persona conversation.

use agent_session::domain::{
    agent_dm::AgentDmConversationRepo,
    error::{AgentSessionError, Result},
};
use bots::domain::ports::{AgentDmEligibility, BotError};
use channels::domain::agent_dm::AgentDmRepo;
use messages::domain::{events::MessagePostedMetadata, models::MessageParent};

use super::broker_events::TriggerDecision;

#[cfg(test)]
mod test;

/// Whether a post belongs to the dedicated DM path.
pub enum DirectMessageDecision {
    /// Ordinary channel or discussion routing should evaluate the post.
    NotDirectMessage,
    /// This is a persona DM, but its sender may no longer invoke its persona.
    /// Never fall back to mentioning a different agent in the same private DM.
    Unavailable,
    /// Deliver to the DM's stable current conversation segment.
    Deliver(Box<TriggerDecision>),
}

/// Agent-DM routing exposed to the common committed-message consumer.
#[async_trait::async_trait]
pub trait DirectMessageRouting: Send + Sync + 'static {
    /// Resolve a private DM after the caller's message-posting access was checked.
    async fn evaluate(&self, posted: &MessagePostedMetadata) -> Result<DirectMessageDecision>;
}

/// Coordinates channel identity, persona permission, and session reservation.
pub struct DirectMessageRouter<Channels, Personas, Sessions> {
    channels: Channels,
    personas: Personas,
    sessions: Sessions,
}

impl<C, P, S> DirectMessageRouter<C, P, S> {
    /// Compose the owning domains' ports.
    pub fn new(channels: C, personas: P, sessions: S) -> Self {
        Self {
            channels,
            personas,
            sessions,
        }
    }
}

#[async_trait::async_trait]
impl<C: AgentDmRepo, P: AgentDmEligibility, S: AgentDmConversationRepo> DirectMessageRouting
    for DirectMessageRouter<C, P, S>
{
    async fn evaluate(&self, posted: &MessagePostedMetadata) -> Result<DirectMessageDecision> {
        let MessageParent::Channel(channel_id) = posted.parent else {
            return Ok(DirectMessageDecision::NotDirectMessage);
        };
        let Some(dm) = self
            .channels
            .find(channel_id)
            .await
            .map_err(anyhow::Error::new)?
        else {
            return Ok(DirectMessageDecision::NotDirectMessage);
        };
        if posted.sender.as_user() != Some(&dm.user_id) {
            return Ok(DirectMessageDecision::Unavailable);
        }
        match self
            .personas
            .authorize_agent_dm(dm.user_id, dm.bot_id)
            .await
        {
            Ok(()) => {}
            Err(BotError::Unauthorized | BotError::NotFound(_)) => {
                return Ok(DirectMessageDecision::Unavailable);
            }
            Err(error) => return Err(AgentSessionError::Unknown(anyhow::Error::new(error))),
        }
        let session_id = self.sessions.current_or_create(channel_id).await?;
        Ok(DirectMessageDecision::Deliver(Box::new(
            TriggerDecision::DirectMessage {
                bot_id: dm.bot_id,
                session_id,
                message: posted.clone(),
            },
        )))
    }
}
