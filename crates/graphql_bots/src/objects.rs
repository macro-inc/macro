use async_graphql::{ID, SimpleObject};
use bots::domain::models::{Bot, BotIdentity};

/// A bot (an agent or an integration) as every view presents it: its name,
/// handle and picture as they are now. Keyed by the bot's id, so every view
/// that shows the bot shares one record. A message the bot sent has
/// `"bot|{id}"` as its sender.
#[derive(Clone, Debug, PartialEq, Eq, SimpleObject)]
pub struct GraphqlBot {
    /// The bot's id, without the `bot|` prefix.
    id: ID,
    /// Display name.
    name: String,
    /// Stable `@` handle, without a leading `@`.
    handle: String,
    /// Avatar, when it has one.
    avatar_url: Option<String>,
    /// When the bot was deleted, in RFC 3339 format. A deleted bot keeps its
    /// identity so older messages and sessions still name it.
    deleted_at: Option<String>,
    /// Whether this is a first-party Macro bot.
    is_system: bool,
}

impl From<BotIdentity> for GraphqlBot {
    fn from(identity: BotIdentity) -> Self {
        Self {
            id: ID(identity.id.to_string()),
            name: identity.name,
            handle: identity.handle,
            avatar_url: identity.avatar_url,
            deleted_at: identity.deleted_at.map(|at| at.to_rfc3339()),
            is_system: identity.is_system,
        }
    }
}

impl From<Bot> for GraphqlBot {
    fn from(bot: Bot) -> Self {
        BotIdentity::from(bot).into()
    }
}
