#![deny(missing_docs)]
//! This crate defines the [ChannelSender] which is a wrapper type which denotes either a first party macro user, OR, a bot user

use bot_id::{BotIdStr, cowlike::CowLike};
use either::Either;
use macro_user_id::{error::ParseErr, user_id::MacroUserIdStr};
use serde::{Deserialize, Serialize};

type InnerVal<'a> = Either<BotIdStr<'a>, MacroUserIdStr<'a>>;

/// Actor identity for channel mutations.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ChannelSender<'a>(pub InnerVal<'a>);

impl<'a> TryFrom<&'a str> for ChannelSender<'a> {
    type Error = ParseErr;

    fn try_from(value: &'a str) -> Result<Self, Self::Error> {
        Self::parse_from_str(value)
    }
}

impl<'a> CowLike<'a> for ChannelSender<'a> {
    type Owned<'b> = ChannelSender<'b>;

    fn into_owned(self) -> Self::Owned<'static> {
        ChannelSender(self.0.into_owned())
    }

    fn copied(&'a self) -> Self {
        ChannelSender(self.0.copied())
    }
}

impl<'a> ChannelSender<'a> {
    /// attempt to return the user id str if this value contains a user
    pub fn as_user(&self) -> Option<&MacroUserIdStr<'a>> {
        self.0.as_ref().right()
    }
    /// attempt to return the bot id str if this value contains a bot
    pub fn as_bot(&self) -> Option<&BotIdStr<'a>> {
        self.0.as_ref().left()
    }

    /// attempt to parse a value of self from an input str
    pub fn parse_from_str(value: &'a str) -> Result<Self, ParseErr> {
        match BotIdStr::try_from(value) {
            Ok(bot_id) => Ok(ChannelSender(Either::Left(bot_id))),
            Err(_) => MacroUserIdStr::try_from(value)
                .map(Either::Right)
                .map(ChannelSender),
        }
    }
}

impl<'a> AsRef<str> for ChannelSender<'a> {
    fn as_ref(&self) -> &str {
        match &self.0 {
            Either::Left(l) => l.as_ref(),
            Either::Right(r) => r.as_ref(),
        }
    }
}

#[cfg(test)]
mod tests {
    use macro_user_id::email::ReadEmailParts;
    use uuid::Uuid;

    use super::*;

    #[test]
    fn sender_round_trips_user_storage_string() {
        let sender = ChannelSender::parse_from_str("macro|alice@example.com").unwrap();

        assert_eq!(sender.as_ref(), "macro|alice@example.com");
        assert!(matches!(sender.0, InnerVal::Right(_)));
    }

    #[test]
    fn sender_round_trips_bot_storage_string() {
        let id = Uuid::new_v4();
        let storage = format!("bot|{id}");
        let sender = ChannelSender::parse_from_str(&storage).unwrap();

        assert_eq!(sender.as_ref(), storage);
        assert_eq!(serde_json::to_value(&sender).unwrap(), storage);
    }

    #[test]
    fn fallback_user_name_uses_email_local_part() {
        let user_id = MacroUserIdStr::parse_from_str("macro|shepherd.hatton@gmail.com").unwrap();

        assert_eq!(user_id.email_part().local_part(), "shepherd.hatton");
    }
}
