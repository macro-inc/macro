//! Translate `macro.agent_sessions` events into harness commands.
//!
//! The trigger service already did the hard part - watching the channel
//! firehose, matching mentions to sessions, dropping the bot's own messages -
//! so this adapter only routes: is this event for our bot, and is it an open
//! or a forward? Pure translation, no IO; the consumer loop lives in the
//! service binary.

use agent_session::domain::model::AgentSessionId;
use agent_trigger::domain::broker_events::{
    AgentTriggerTopicEvent, ChannelEventMetadata, ExistingAgentSessionEvent, NewAgentSessionEvent,
};
use bot_id::BotId;

use crate::domain::model::{
    AgentKind, AnnounceOrigin, AnnouncePrompt, DeliverAction, HarnessCommand, MentionOrigin,
    OpenSession, is_macro_staff,
};

#[cfg(test)]
mod test;

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
    /// We are in beta and only allow Macro employees to use this new harness system.
    NotMacroStaff,
}

/// Route one trigger event: work for this deployment, or a reason it was
/// skipped.
///
/// Opens are only ours when the mentioned bot is one of `our_bots` - external
/// bots' runtimes open their own sessions over the API. A deployment serves
/// the sandboxed coder bot, the in-memory Macro bot when configured, and,
/// when it holds a Cursor API key, the Cursor bot too, which is why this is a
/// set rather than one id. Events for sessions that already exist always
/// carry work: a prompt to deliver when the session is managed here, or just
/// its announcement when the bot's own runtime delivers the prompt.
pub fn route_agent_trigger(
    event: AgentTriggerTopicEvent,
    our_bots: &[BotId],
) -> Result<RoutedTrigger, Skipped> {
    match event {
        AgentTriggerTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(mentioned)) => {
            // TODO: remove once the beta gate opens. Both managed bots are
            // staff-only for the same reason — neither is finished — and a
            // Cursor session now runs on the mentioner's own Cursor account,
            // so nothing about the credential keeps it restricted.
            if mentioned
                .message
                .sender
                .as_user()
                .is_some_and(|user| !is_macro_staff(user))
            {
                return Err(Skipped::NotMacroStaff);
            }

            if !our_bots.contains(&mentioned.bot_id) {
                return Err(Skipped::ForeignBot);
            }
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
            let kind = AgentKind::of(bot_id);
            if kind.is_managed() {
                // A managed session's prompt is delivered (and announced)
                // by the deployment that manages it; anyone else stays out
                // of the way entirely.
                if !our_bots.contains(&bot_id) {
                    return Err(Skipped::ForeignBot);
                }
                // The open gate alone is not enough: the mentioning channel
                // holds editor access to the session, so anyone in the
                // thread can prompt it. A prompt to a Cursor session is spend
                // on its *owner's* Cursor account, by someone who is not
                // necessarily the owner - staff only while that is true, and
                // a sender that is not a user at all is refused rather than
                // waved through.
                if kind == AgentKind::Cursor
                    && !message
                        .sender
                        .as_user()
                        .is_some_and(|user| is_macro_staff(user))
                {
                    return Err(Skipped::NotMacroStaff);
                }
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
