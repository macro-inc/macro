#![deny(missing_docs)]
//! Channel attribution for Macro users, bots, and account-scoped external customers.

use bot_id::{BotId, BotIdStr, cowlike::CowLike};
use macro_user_id::{error::ParseErr, user_id::MacroUserIdStr};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Attribution identity. External authors are never authentication principals.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum SenderIdentity<'a> {
    /// A Macro bot principal.
    Bot(BotIdStr<'a>),
    /// An authenticated Macro user.
    User(MacroUserIdStr<'a>),
    /// Account-scoped external attribution, with a server-generated identity UUID.
    External(Cow<'a, str>),
}

type InnerVal<'a> = SenderIdentity<'a>;

/// Stored channel attribution; external senders are never authentication principals.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ChannelSender<'a>(pub InnerVal<'a>);

#[cfg(feature = "schema")]
impl<'a> utoipa::ToSchema for ChannelSender<'a> {
    fn name() -> std::borrow::Cow<'static, str> {
        std::borrow::Cow::Borrowed("ChannelSender")
    }
}

#[cfg(feature = "schema")]
impl<'a> utoipa::PartialSchema for ChannelSender<'a> {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        String::schema()
    }
}

impl<'a> TryFrom<&'a str> for ChannelSender<'a> {
    type Error = ParseErr;

    fn try_from(value: &'a str) -> Result<Self, Self::Error> {
        Self::parse_from_str(value)
    }
}

impl TryFrom<String> for ChannelSender<'static> {
    type Error = ParseErr;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        ChannelSender::parse_from_str(&value).map(CowLike::into_owned)
    }
}

impl From<ChannelSender<'_>> for String {
    fn from(value: ChannelSender<'_>) -> Self {
        value.as_ref().to_string()
    }
}

impl<'a> CowLike<'a> for ChannelSender<'a> {
    type Owned<'b> = ChannelSender<'b>;

    fn into_owned(self) -> Self::Owned<'static> {
        ChannelSender(match self.0 {
            InnerVal::User(user) => InnerVal::User(user.into_owned()),
            InnerVal::Bot(bot) => InnerVal::Bot(bot.into_owned()),
            InnerVal::External(id) => InnerVal::External(Cow::Owned(id.into_owned())),
        })
    }

    fn copied(&'a self) -> Self {
        ChannelSender(match &self.0 {
            InnerVal::User(user) => InnerVal::User(user.copied()),
            InnerVal::Bot(bot) => InnerVal::Bot(bot.copied()),
            InnerVal::External(id) => InnerVal::External(Cow::Borrowed(id.as_ref())),
        })
    }
}

impl<'a> ChannelSender<'a> {
    /// attempt to return the user id str if this value contains a user
    pub fn as_user(&self) -> Option<&MacroUserIdStr<'a>> {
        match &self.0 {
            InnerVal::User(user) => Some(user),
            _ => None,
        }
    }
    /// attempt to return the bot id str if this value contains a bot
    pub fn as_bot(&self) -> Option<&BotIdStr<'a>> {
        match &self.0 {
            InnerVal::Bot(bot) => Some(bot),
            _ => None,
        }
    }
    /// attempt to return the user id str if this value contains a user
    pub fn into_user(self) -> Option<MacroUserIdStr<'a>> {
        match self.0 {
            InnerVal::User(user) => Some(user),
            _ => None,
        }
    }
    /// attempt to return the bot id str if this value contains a bot
    pub fn into_bot(self) -> Option<BotIdStr<'a>> {
        match self.0 {
            InnerVal::Bot(bot) => Some(bot),
            _ => None,
        }
    }

    /// attempt to parse a value of self from an input str
    pub fn parse_from_str(value: &'a str) -> Result<Self, ParseErr> {
        if let Some(id) = value.strip_prefix("external|")
            && let Ok(id) = Uuid::parse_str(id)
            && !id.is_nil()
            && value == format!("external|{id}")
        {
            return Ok(Self(InnerVal::External(Cow::Borrowed(value))));
        }
        match BotIdStr::try_from(value) {
            Ok(bot_id) => Ok(ChannelSender(InnerVal::Bot(bot_id))),
            Err(_) => MacroUserIdStr::try_from(value)
                .map(InnerVal::User)
                .map(ChannelSender),
        }
    }

    /// Create an external attribution identity. This never grants channel access.
    pub fn new_external(id: Uuid) -> Option<ChannelSender<'static>> {
        if id.is_nil() {
            return None;
        }
        Some(ChannelSender(InnerVal::External(Cow::Owned(format!(
            "external|{id}"
        )))))
    }

    /// Whether the author is an external customer, not a user or bot principal.
    pub fn is_external(&self) -> bool {
        matches!(self.0, InnerVal::External(_))
    }

    /// create a new instance of self containing a [MacroUserIdStr]
    pub fn new_from_user(user: MacroUserIdStr<'a>) -> Self {
        Self(InnerVal::User(user))
    }

    /// create a new instance of self containing a [BotIdStr] derived from the given [BotId]
    pub fn new_from_bot(bot_id: BotId) -> ChannelSender<'static> {
        ChannelSender(InnerVal::Bot(bot_id.into_storage_id()))
    }
}

impl<'a> AsRef<str> for ChannelSender<'a> {
    fn as_ref(&self) -> &str {
        match &self.0 {
            InnerVal::Bot(l) => l.as_ref(),
            InnerVal::User(r) => r.as_ref(),
            InnerVal::External(id) => id.as_ref(),
        }
    }
}
