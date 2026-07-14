//! Domain models for channel bot triggers.

use channels::domain::models::MutatedMessage;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

/// The kind of event that triggered a bot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BotTrigger {
    /// The bot was `@`-mentioned in a channel message.
    Mention,
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
