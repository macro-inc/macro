//! Domain models for channel bot triggers.

use bot_id::BotId;
use channels::domain::models::MutatedMessage;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

/// The kind of event that triggered a bot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BotTrigger {
    /// The bot was `@`-mentioned in a channel message.
    Mention,
    /// A classifier inferred that a thread message expects the bot to respond
    /// even though it was not `@`-mentioned.
    Inferred,
}

/// A decision to invoke a bot for a candidate message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BotInvocation {
    /// The bot to invoke.
    pub bot_id: BotId,
    /// Why the bot is being invoked.
    pub trigger: BotTrigger,
}

/// A normalized trigger delivered to a system bot handler.
#[derive(Debug, Clone)]
pub struct BotEvent {
    /// What triggered the bot.
    pub trigger: BotTrigger,
    /// Channel the trigger occurred in.
    pub channel_id: Uuid,
    /// The user-authored message that triggered the bot.
    pub message: MutatedMessage,
    /// Thread the bot should reply in. For a top-level message this is the
    /// message id; for a reply it is the existing thread id.
    pub reply_thread_id: Uuid,
    /// The user who triggered the bot.
    pub requesting_user: MacroUserIdStr<'static>,
}

/// A thread message rendered for trigger inference, oldest-first.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranscriptMessage {
    /// Whether the agent itself authored the message.
    pub from_agent: bool,
    /// Display label for the sender.
    pub sender: String,
    /// Message body.
    pub content: String,
}
