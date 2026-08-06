//! Translate `macro.agent_sessions` events into harness commands.
//!
//! The trigger service already did the hard part - watching the channel
//! firehose, matching mentions to sessions, dropping the bot's own messages -
//! so this adapter only routes: is this event for our bot, and is it an open
//! or a forward? Pure translation, no IO; the consumer loop lives in the
//! service binary.

use agent_trigger::domain::broker_events::{
    AgentTriggerTopicEvent, ChannelEventMetadata, ExistingAgentSessionEvent, NewAgentSessionEvent,
};
use bot_id::BotId;

use crate::domain::model::{ForwardMessage, MentionOrigin, OpenSession};

#[cfg(test)]
mod test;

/// A trigger event translated into the harness's vocabulary.
#[derive(Debug, Clone)]
pub enum HarnessCommand {
    /// Open a new session.
    Open(OpenSession),
    /// Feed a session that already exists.
    Forward(ForwardMessage),
}

/// Why an event yielded no command. Only for logging - none of these are
/// errors, and the consumer commits the offset either way.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Skipped {
    /// The event belongs to a different bot's deployment.
    ForeignBot,
    /// The sender is not a user, so there is nobody to own the session.
    NotFromUser,
    /// An event shape this harness does not recognise yet - the trigger's
    /// vocabulary is non-exhaustive on purpose, and unknown shapes are
    /// skipped rather than wedging the partition.
    Unrecognized,
}

/// Route one trigger event: a command for `our_bot`, or a reason it was
/// skipped.
pub fn agent_trigger_to_harness_command(
    event: AgentTriggerTopicEvent,
    our_bot: BotId,
) -> Result<HarnessCommand, Skipped> {
    match event {
        AgentTriggerTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(mentioned)) => {
            if mentioned.bot_id != our_bot {
                return Err(Skipped::ForeignBot);
            }
            let message = mentioned.message;
            let sender = message
                .sender
                .as_user()
                .cloned()
                .ok_or(Skipped::NotFromUser)?;
            Ok(HarnessCommand::Open(OpenSession {
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
            }))
        }
        AgentTriggerTopicEvent::Existing(ExistingAgentSessionEvent::Channel(
            ChannelEventMetadata {
                bot_id,
                session_id,
                kind: _,
                message,
            },
        )) => {
            if bot_id != our_bot {
                return Err(Skipped::ForeignBot);
            }
            Ok(HarnessCommand::Forward(ForwardMessage {
                session_id,
                sender: message.sender.as_user().cloned(),
                content: message.content,
            }))
        }
        _ => Err(Skipped::Unrecognized),
    }
}
