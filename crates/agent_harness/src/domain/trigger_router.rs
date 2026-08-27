//! Decide how agent-session broker events are handled by this deployment.

use agent_session::domain::model::AgentSessionId;
use agent_trigger::domain::broker_events::{
    AgentTriggerTopicEvent, ChannelEventMetadata, ExistingAgentSessionEvent, NewAgentSessionEvent,
};
use bot_id::BotId;

use super::model::{
    AgentKind, AgentRuntimeConfig, AnnounceOrigin, AnnouncePrompt, DeliverAction, HarnessCommand,
    MentionOrigin, OpenSession,
};

/// What one trigger event asks this deployment to do.
#[derive(Debug, Clone)]
pub enum RoutedTrigger {
    /// Run a harness command for the managed bot's session.
    Command(AgentSessionId, HarnessCommand),
    /// Post the chip for a prompt an external bot's runtime delivers itself.
    Announce(AgentSessionId, AnnouncePrompt),
}

/// Why an event yielded no work. Only for logging - none of these are
/// errors, and the consumer commits the offset either way.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Skipped {
    /// The event is another deployment's to act on: an open for a bot whose
    /// runtime opens its own sessions, or managed traffic that is not ours.
    ForeignBot,
    /// The sender is not a user, so there is nobody to own the session.
    NotFromUser,
    /// An event shape this harness does not recognise yet - the trigger's
    /// vocabulary is non-exhaustive on purpose, and unknown shapes are
    /// skipped rather than wedging the partition.
    Unrecognized,
}

/// Bot targeted by a recognized trigger event shape.
#[must_use]
pub fn agent_trigger_bot_id(event: &AgentTriggerTopicEvent) -> Option<BotId> {
    match event {
        AgentTriggerTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(mentioned)) => {
            Some(mentioned.bot_id)
        }
        AgentTriggerTopicEvent::Existing(ExistingAgentSessionEvent::Channel(metadata)) => {
            Some(metadata.bot_id)
        }
        _ => None,
    }
}

/// Route one trigger event: work for this deployment, or a reason it was
/// skipped.
///
/// Opens are only ours when `runtime` resolves to a managed profile. External
/// bots' runtimes open their own sessions over the API. Events for sessions
/// that already exist always carry work: a prompt to deliver when the session
/// is managed here, or just its announcement when the bot's own runtime
/// delivers the prompt.
pub fn route_agent_trigger(
    event: AgentTriggerTopicEvent,
    runtime: Option<AgentRuntimeConfig>,
) -> Result<RoutedTrigger, Skipped> {
    match event {
        AgentTriggerTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(mentioned)) => {
            let Some(runtime) = runtime.filter(|runtime| runtime.kind.is_managed()) else {
                return Err(Skipped::ForeignBot);
            };
            let message = mentioned.message;
            let sender = message
                .sender
                .as_user()
                .cloned()
                .ok_or(Skipped::NotFromUser)?;
            Ok(RoutedTrigger::Command(
                AgentSessionId::new(),
                HarnessCommand::Open(OpenSession {
                    bot_id: mentioned.bot_id,
                    runtime,
                    origin: MentionOrigin {
                        channel_id: message.channel_id,
                        // A top-level mention roots its own thread; a mention
                        // inside a thread answers into that thread.
                        thread_id: message.thread_id.unwrap_or(message.message_id),
                        message_id: message.message_id,
                        sender,
                        content: message.content,
                    },
                }),
            ))
        }
        AgentTriggerTopicEvent::Existing(ExistingAgentSessionEvent::Channel(
            ChannelEventMetadata {
                bot_id,
                session_id,
                kind: _,
                message,
            },
        )) => {
            let origin = AnnounceOrigin {
                channel_id: message.channel_id,
                thread_id: message.thread_id.unwrap_or(message.message_id),
                message_id: message.message_id,
            };
            let kind = runtime
                .as_ref()
                .map_or(AgentKind::External, |runtime| runtime.kind);
            if kind.is_managed() {
                return Ok(RoutedTrigger::Command(
                    session_id,
                    HarnessCommand::Deliver(DeliverAction::prompt(
                        message.content,
                        message.sender.as_user().cloned(),
                        Some(origin),
                    )),
                ));
            }
            let sender = message
                .sender
                .as_user()
                .cloned()
                .ok_or(Skipped::NotFromUser)?;
            Ok(RoutedTrigger::Announce(
                session_id,
                AnnouncePrompt {
                    bot_id,
                    origin,
                    content: message.content,
                    sender,
                },
            ))
        }
        _ => Err(Skipped::Unrecognized),
    }
}
