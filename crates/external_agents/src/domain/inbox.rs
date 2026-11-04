//! Recording the messages that addressed external agents.
//!
//! The agent trigger already decides when a message addresses an agent: a
//! turn in someone's direct conversation with it, or a mention it may answer.
//! For an external agent, each such trigger becomes one event in its inbox,
//! pushed to its endpoint when it has one.

#[cfg(test)]
mod test;

use agent_trigger::domain::broker_events::{AgentTriggerTopicEvent, NewAgentSessionEvent};
use bot_id::BotId;
use macro_event_broker::Event;
use messages::domain::events::MessagePostedMetadata;

use super::models::{ExternalAgentEvent, ExternalAgentEventKind};
use super::ports::{AgentEndpoints, ExternalAgentInbox, ExternalAgentRepo, Result};

/// Records external agents' triggers and pushes them to their endpoints.
pub struct ExternalAgentInboxService<R, E> {
    repo: R,
    endpoints: E,
}

impl<R, E> ExternalAgentInboxService<R, E> {
    /// Compose the inbox and endpoint ports.
    pub fn new(repo: R, endpoints: E) -> Self {
        Self { repo, endpoints }
    }
}

/// The agent a trigger addresses, how, and the message that did.
///
/// Sessions an external agent never opened have no follow-ups, and task
/// assignments and composer requests carry no message to answer.
fn addressed(
    event: &AgentTriggerTopicEvent,
) -> Option<(BotId, ExternalAgentEventKind, MessagePostedMetadata)> {
    match event {
        AgentTriggerTopicEvent::New(NewAgentSessionEvent::ConversationMessage(turn)) => Some((
            turn.bot_id,
            ExternalAgentEventKind::DirectMessage,
            turn.message.clone(),
        )),
        AgentTriggerTopicEvent::New(new) => new.mention().map(|mention| {
            (
                mention.bot_id,
                ExternalAgentEventKind::Mention,
                mention.message,
            )
        }),
        AgentTriggerTopicEvent::Existing(_) => None,
    }
}

impl<R: ExternalAgentRepo, E: AgentEndpoints> ExternalAgentInbox for ExternalAgentInboxService<R, E> {
    #[tracing::instrument(skip_all, fields(trigger_event_id = %trigger.event_id), err)]
    async fn record_trigger(&self, trigger: &Event<AgentTriggerTopicEvent>) -> Result<()> {
        let Some((bot_id, kind, message)) = addressed(&trigger.event) else {
            return Ok(());
        };
        let Some(agent) = self.repo.get(&[bot_id]).await?.into_iter().next() else {
            return Ok(());
        };
        let Some(invoking_user) = message.invoking_user() else {
            return Ok(());
        };
        // A direct conversation is its timeline, so its turns are answered
        // there; a mention is answered in the thread it was made in.
        let reply_thread_id = match kind {
            ExternalAgentEventKind::DirectMessage => message.thread_id.map(|_| message.root_id),
            ExternalAgentEventKind::Mention => Some(message.root_id),
        };
        let event = self
            .repo
            .record(
                ExternalAgentEvent {
                    id: macro_uuid::generate_uuid_v7(),
                    bot_id,
                    kind,
                    parent: message.parent,
                    message_id: message.message_id,
                    message_thread_id: message.thread_id,
                    reply_thread_id,
                    sender_id: message.sender.as_ref().to_owned(),
                    invoking_user,
                    content: message.content,
                    message_created_at: message.created_at,
                },
                trigger.event_id,
            )
            .await?;
        // A redelivered trigger pushes its stored event again; the delivery
        // queue sends one event to one endpoint once.
        if let Some(webhook_id) = agent.webhook_id {
            self.endpoints.push(&webhook_id, &event).await?;
        }
        Ok(())
    }
}
