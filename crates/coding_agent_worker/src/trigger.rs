//! Translate agent-trigger broker events into the work this daemon serves.
//!
//! Pure event vocabulary, split out so it can be tested without a live stream
//! or harness - the same shape as the harness service's own Kafka inbound.

use agent_session::domain::model::AgentSessionId;
use agent_trigger::domain::broker_events::{
    AgentTriggerEventName, AgentTriggerTopicEvent, ExistingAgentSessionEvent, NewAgentSessionEvent,
};
use bot_id::BotId;
use macro_event_broker::Event;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use strum::IntoEnumIterator as _;
use webhook::domain::models::WebhookFilter;

#[cfg(test)]
mod test;

/// What one trigger event asks this daemon to do.
///
/// Pure translation from the event vocabulary, split out so it can be tested
/// without HTTP or a live service - the same shape as the harness service's
/// own Kafka inbound.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TriggerWork {
    /// Open a session for a mention, serve it, and forward the mention as
    /// its first prompt.
    OpenAndPrompt {
        /// The mentioned agent the session runs for. One harness serves many
        /// agents, so the daemon must name the bot when creating the session.
        bot: BotId,
        /// Who asked; owns the session and authors the prompt.
        sender: MacroUserIdStr<'static>,
        /// Channel the mention was posted in.
        channel_id: Uuid,
        /// Thread the mention roots.
        thread_id: Uuid,
        /// The mentioning message.
        message_id: Uuid,
        /// The mention's text: the first prompt, and the announcement quote.
        content: String,
    },
    /// Forward a message into a session that already exists, serving it
    /// first if this daemon is not already. Just the prompt: the harness
    /// service announces the reply into its channel from the trigger event
    /// it observed.
    PromptExisting {
        /// The session to feed.
        session: AgentSessionId,
        /// Who sent the message.
        sender: MacroUserIdStr<'static>,
        /// The message's text.
        content: String,
    },
}

/// Why an event yielded no work. Only for logging - none of these are
/// errors, and the stream is left open either way.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Skipped {
    /// The sender is not a user, so there is nobody to act for.
    NotFromUser,
    /// An event shape this daemon does not recognise yet - the trigger's
    /// vocabulary is non-exhaustive on purpose.
    Unrecognized,
}

/// Translate one trigger event into this daemon's work, or a reason to skip.
pub fn trigger_to_work(event: AgentTriggerTopicEvent) -> Result<TriggerWork, Skipped> {
    match event {
        AgentTriggerTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(mentioned)) => {
            let message = mentioned.message;
            let sender = message
                .sender
                .as_user()
                .cloned()
                .ok_or(Skipped::NotFromUser)?;
            Ok(TriggerWork::OpenAndPrompt {
                bot: mentioned.bot_id,
                sender,
                channel_id: message.channel_id,
                // A top-level mention roots its own thread; a mention inside
                // a thread answers into that thread.
                thread_id: message.thread_id.unwrap_or(message.message_id),
                message_id: message.message_id,
                content: message.content,
            })
        }
        AgentTriggerTopicEvent::Existing(ExistingAgentSessionEvent::Channel(metadata)) => {
            let sender = metadata
                .message
                .sender
                .as_user()
                .cloned()
                .ok_or(Skipped::NotFromUser)?;
            Ok(TriggerWork::PromptExisting {
                session: metadata.session_id,
                sender,
                content: metadata.message.content,
            })
        }
        _ => Err(Skipped::Unrecognized),
    }
}

/// Every event this daemon's stream asks for, scoped to the bound bots.
///
/// A name this daemon does not yet handle is still worth subscribing to -
/// it arrives, is recognised as unsupported, and is skipped - which beats
/// silently never being sent it.
pub fn trigger_filters(bots: impl IntoIterator<Item = impl ToString>) -> Vec<WebhookFilter> {
    let ids: Vec<String> = bots.into_iter().map(|bot| bot.to_string()).collect();
    vec![WebhookFilter {
        events: AgentTriggerEventName::iter()
            .map(|event| event.to_string())
            .collect(),
        ids: Some(ids),
    }]
}

/// Executes translated work. The one capability the stream listener needs,
/// so tests can drive it without a live service or harness.
pub trait WorkExecutor: Send + Sync + 'static {
    /// Do one event's work. SSE has no redelivery, so the listener logs a
    /// failure and keeps the stream open.
    fn execute(
        &self,
        work: TriggerWork,
    ) -> impl Future<Output = Result<(), crate::dispatch::DispatchError>> + Send;
}

/// The envelope the stream delivers: the broker's, carrying a trigger event.
pub type TriggerEvent = Event<AgentTriggerTopicEvent>;

/// Translate one delivered event and execute it. Skippable events are
/// ignored; an execute failure is returned so the caller can log it.
#[tracing::instrument(skip(executor, event), fields(event_id = %event.event_id), err)]
pub async fn handle_event<Executor: WorkExecutor>(
    event: TriggerEvent,
    executor: &Executor,
) -> Result<(), crate::dispatch::DispatchError> {
    match trigger_to_work(event.event) {
        Ok(work) => executor.execute(work).await,
        Err(skipped) => {
            tracing::debug!(?skipped, "agent-trigger stream event skipped");
            Ok(())
        }
    }
}
