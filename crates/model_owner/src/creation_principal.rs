//! The verified principal a new entity is created for.

use bot_id::{BotId, NonSystemBotId};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::Owner;

#[cfg(test)]
mod test;

/// Who creates an entity, and so who owns it and who acts.
///
/// Owner, actor, and acting user all derive from this one value, so they
/// cannot disagree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CreationPrincipal {
    /// A user creating for themself.
    User(MacroUserIdStr<'static>),
    /// A bot acting for a verified user. The user owns the result.
    BotForUser {
        /// The acting bot.
        bot: BotId,
        /// The user the bot acts for.
        user: MacroUserIdStr<'static>,
    },
    /// A team-scoped bot with no acting user. The bot owns the result.
    TeamBot {
        /// The owning bot.
        bot: NonSystemBotId,
        /// The bot's verified team.
        team: Uuid,
    },
}

impl CreationPrincipal {
    /// Who owns the created entity.
    #[must_use]
    pub fn owner(&self) -> Owner {
        match self {
            Self::User(user) | Self::BotForUser { user, .. } => Owner::User(user.clone()),
            Self::TeamBot { bot, .. } => Owner::Bot(bot.get()),
        }
    }

    /// The user this creation acts as, or `None` for a team bot.
    #[must_use]
    pub fn user(&self) -> Option<&MacroUserIdStr<'static>> {
        match self {
            Self::User(user) | Self::BotForUser { user, .. } => Some(user),
            Self::TeamBot { .. } => None,
        }
    }

    /// The bot performing this creation, or `None` for a user.
    #[must_use]
    pub fn bot(&self) -> Option<BotId> {
        match self {
            Self::User(_) => None,
            Self::BotForUser { bot, .. } => Some(*bot),
            Self::TeamBot { bot, .. } => Some(bot.get()),
        }
    }
}
