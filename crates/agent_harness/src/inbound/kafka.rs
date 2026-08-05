//! Translate `macro.agent_sessions` events into harness commands.
//!
//! The trigger service already did the hard part - watching the channel
//! firehose, matching mentions to sessions, dropping the bot's own messages -
//! so this adapter only routes: is this event for our bot, and is it an open
//! or a forward? Pure translation, no IO; the consumer loop lives in the
//! service binary.

use agent_trigger::domain::broker_events::{
    AgentSessionTopicEvent, ChannelEventMetadata, ExistingAgentSessionEvent, NewAgentSessionEvent,
};
use bot_id::BotId;
use channels::domain::broker_events::ChannelMessagePostedMetadata;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::service::{ForwardMessage, MentionOrigin, OpenSession};

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
pub fn command_for(
    event: AgentSessionTopicEvent,
    our_bot: BotId,
) -> Result<HarnessCommand, Skipped> {
    match event {
        AgentSessionTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(mentioned)) => {
            if mentioned.bot_id != our_bot {
                return Err(Skipped::ForeignBot);
            }
            let origin = origin_of(&mentioned.message).ok_or(Skipped::NotFromUser)?;
            Ok(HarnessCommand::Open(OpenSession {
                bot_id: mentioned.bot_id,
                origin,
            }))
        }
        AgentSessionTopicEvent::Existing(ExistingAgentSessionEvent::Channel(
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
                sender: sender_of(&message),
                content: message.content,
            }))
        }
        // Both event enums are non-exhaustive: the trigger may grow new
        // session sources before this harness learns them.
        _ => Err(Skipped::Unrecognized),
    }
}

/// The mention as domain vocabulary, when a user sent it.
fn origin_of(message: &ChannelMessagePostedMetadata) -> Option<MentionOrigin> {
    let sender = sender_of(message)?;
    Some(MentionOrigin {
        channel_id: message.channel_id,
        // A top-level mention roots its own thread; a mention inside a thread
        // answers into that thread.
        thread_id: message.thread_id.unwrap_or(message.message_id),
        message_id: message.message_id,
        sender,
        content: message.content.clone(),
    })
}

/// The message's author, when it is a user. Bot senders yield `None`: another
/// bot cannot own an agent session, and the trigger already drops our own
/// messages.
fn sender_of(message: &ChannelMessagePostedMetadata) -> Option<MacroUserIdStr<'static>> {
    message.sender.as_user().cloned()
}
