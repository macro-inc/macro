//! Routing for a channel where an agent persona converses: messages there are
//! turns for it, with no mention needed.

use agent_session::domain::{
    agent_conversation::{AgentConversation, AgentConversationRepo},
    error::{AgentSessionError, Result},
};
use bots::domain::ports::{AgentDmEligibility, BotError};
use channels::domain::channel_agents::{ChannelAgentKind, ChannelAgentRepo};
use messages::domain::{events::MessagePostedMetadata, models::MessageParent};

use super::broker_events::TriggerDecision;

#[cfg(test)]
mod test;

/// Whether a post is a turn in an agent's conversation.
pub enum ConversationDecision {
    /// No agent converses in this channel; mention routing evaluates the post.
    NotConversation,
    /// An agent converses here, but the sender may not prompt it now.
    /// Never fall back to mentioning a different agent in the same channel.
    Unavailable,
    /// Deliver to the current session of each agent conversing here.
    Deliver(Vec<TriggerDecision>),
}

/// Conversation routing exposed to the common committed-message consumer.
#[async_trait::async_trait]
pub trait ConversationRouting: Send + Sync + 'static {
    /// Resolve a channel's agent conversations after the caller's
    /// message-posting access was checked.
    async fn evaluate(&self, posted: &MessagePostedMetadata) -> Result<ConversationDecision>;
}

/// Coordinates channel agents, persona permission, and session reservation.
pub struct ConversationRouter<Channels, Personas, Sessions> {
    channels: Channels,
    personas: Personas,
    sessions: Sessions,
}

impl<C, P, S> ConversationRouter<C, P, S> {
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
impl<C: ChannelAgentRepo, P: AgentDmEligibility, S: AgentConversationRepo> ConversationRouting
    for ConversationRouter<C, P, S>
{
    async fn evaluate(&self, posted: &MessagePostedMetadata) -> Result<ConversationDecision> {
        let MessageParent::Channel(channel_id) = posted.parent else {
            return Ok(ConversationDecision::NotConversation);
        };
        let agents = self
            .channels
            .agents_in(channel_id)
            .await
            .map_err(anyhow::Error::new)?;
        let mut deliveries = Vec::new();
        for agent in agents {
            match agent.kind {
                ChannelAgentKind::Direct { user_id } => {
                    // Only the owner prompts a direct conversation: the agent
                    // acts with their access.
                    if posted.sender.as_user() != Some(&user_id) {
                        return Ok(ConversationDecision::Unavailable);
                    }
                    // The conversation is the channel's timeline. A reply in a
                    // thread is not one of its turns: the answer would land in
                    // the timeline, away from the thread, and the turn's status
                    // and retry would show nowhere. A thread here routes as in
                    // any channel, so mentioning the agent there still works.
                    if posted.thread_id.is_some() {
                        continue;
                    }
                    match self
                        .personas
                        .authorize_agent_dm(user_id, agent.bot_id)
                        .await
                    {
                        Ok(()) => {}
                        Err(BotError::Unauthorized | BotError::NotFound(_)) => {
                            return Ok(ConversationDecision::Unavailable);
                        }
                        Err(error) => {
                            return Err(AgentSessionError::Unknown(anyhow::Error::new(error)));
                        }
                    }
                }
                // Which messages a member of a shared channel answers is not
                // decided yet, so mentions keep routing there.
                ChannelAgentKind::Member => continue,
            }
            let session_id = self
                .sessions
                .current_or_create(AgentConversation {
                    channel_id,
                    bot_id: agent.bot_id,
                })
                .await?;
            deliveries.push(TriggerDecision::ConversationMessage {
                bot_id: agent.bot_id,
                session_id,
                message: posted.clone(),
            });
        }
        Ok(if deliveries.is_empty() {
            ConversationDecision::NotConversation
        } else {
            ConversationDecision::Deliver(deliveries)
        })
    }
}
