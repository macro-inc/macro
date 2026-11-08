#![deny(missing_docs)]
//! Message author identities: Macro users, bots, and call-scoped guests.

use bot_id::{BotId, BotIdStr, cowlike::CowLike};
use macro_user_id::{error::ParseErr, user_id::MacroUserIdStr};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;

#[cfg(test)]
mod test;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum InnerVal<'a> {
    Bot(BotIdStr<'a>),
    User(MacroUserIdStr<'a>),
    Guest(Cow<'a, str>),
}

/// Actor identity for channel mutations.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ChannelSender<'a>(InnerVal<'a>);

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
            InnerVal::Bot(id) => InnerVal::Bot(id.into_owned()),
            InnerVal::User(id) => InnerVal::User(id.into_owned()),
            InnerVal::Guest(id) => InnerVal::Guest(Cow::Owned(id.into_owned())),
        })
    }

    fn copied(&'a self) -> Self {
        ChannelSender(match &self.0 {
            InnerVal::Bot(id) => InnerVal::Bot(id.copied()),
            InnerVal::User(id) => InnerVal::User(id.copied()),
            InnerVal::Guest(id) => InnerVal::Guest(Cow::Borrowed(id)),
        })
    }
}

impl<'a> ChannelSender<'a> {
    /// attempt to return the user id str if this value contains a user
    pub fn as_user(&self) -> Option<&MacroUserIdStr<'a>> {
        match &self.0 {
            InnerVal::User(id) => Some(id),
            _ => None,
        }
    }
    /// attempt to return the bot id str if this value contains a bot
    pub fn as_bot(&self) -> Option<&BotIdStr<'a>> {
        match &self.0 {
            InnerVal::Bot(id) => Some(id),
            _ => None,
        }
    }
    /// attempt to return the user id str if this value contains a user
    pub fn into_user(self) -> Option<MacroUserIdStr<'a>> {
        match self.0 {
            InnerVal::User(id) => Some(id),
            _ => None,
        }
    }
    /// attempt to return the bot id str if this value contains a bot
    pub fn into_bot(self) -> Option<BotIdStr<'a>> {
        match self.0 {
            InnerVal::Bot(id) => Some(id),
            _ => None,
        }
    }

    /// attempt to parse a value of self from an input str
    pub fn parse_from_str(value: &'a str) -> Result<Self, ParseErr> {
        if let Some(id) = value.strip_prefix("guest|")
            && uuid::Uuid::parse_str(id).is_ok_and(|uuid| uuid.to_string() == id)
        {
            return Ok(Self(InnerVal::Guest(Cow::Borrowed(value))));
        }
        match BotIdStr::try_from(value) {
            Ok(bot_id) => Ok(ChannelSender(InnerVal::Bot(bot_id))),
            Err(_) => MacroUserIdStr::try_from(value)
                .map(InnerVal::User)
                .map(ChannelSender),
        }
    }

    /// create a new instance of self containing a [MacroUserIdStr]
    pub fn new_from_user(user: MacroUserIdStr<'a>) -> Self {
        Self(InnerVal::User(user))
    }

    /// create a new instance of self containing a [BotIdStr] derived from the given [BotId]
    pub fn new_from_bot(bot_id: BotId) -> ChannelSender<'static> {
        ChannelSender(InnerVal::Bot(bot_id.into_storage_id()))
    }

    /// Author identity only; callers must separately authorize active call membership.
    pub fn new_from_guest(id: uuid::Uuid) -> ChannelSender<'static> {
        ChannelSender(InnerVal::Guest(Cow::Owned(format!("guest|{id}"))))
    }

    /// Whether this is a non-account guest, never a user or bot principal.
    pub fn is_guest(&self) -> bool {
        matches!(self.0, InnerVal::Guest(_))
    }
}

impl<'a> AsRef<str> for ChannelSender<'a> {
    fn as_ref(&self) -> &str {
        match &self.0 {
            InnerVal::Bot(id) => id.as_ref(),
            InnerVal::User(id) => id.as_ref(),
            InnerVal::Guest(id) => id.as_ref(),
        }
    }
}
