#![deny(missing_docs)]

//! Typed owner reference for Macro entities.
//!
//! [`Owner`] is the domain value. [`OwnerType`] is the closed string set for
//! the sqlx type `entity_owner_type` and the matching wire discriminator.
//!
//! ```
//! use model_owner::{Owner, OwnerType};
//!
//! let owner = Owner::parse(OwnerType::User, "macro|hutch@macro.com").unwrap();
//! assert_eq!(owner.principal_id(), "macro|hutch@macro.com");
//! ```

use std::fmt::{Display, Formatter, Result as FmtResult};
use std::str::FromStr;

use bot_id::{BotId, BotIdStr};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(test)]
mod test;

const USER_PRINCIPAL_PREFIX: &str = "macro|";
const BOT_PRINCIPAL_PREFIX: &str = "bot|";
const TEAM_UUID_HYPHENATED_LEN: usize = 36;

const OWNER_TYPE_USER: &str = "user";
const OWNER_TYPE_BOT: &str = "bot";
const OWNER_TYPE_TEAM: &str = "team";

/// Who owns an entity.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(into = "String", try_from = "String")]
pub enum Owner {
    /// A Macro user (`macro|<email>`).
    User(MacroUserIdStr<'static>),
    /// A bot (`bot|<uuid>`).
    Bot(BotId),
    /// A team (hyphenated UUID, no prefix).
    Team(Uuid),
}

/// Closed owner-type set for the sqlx type `entity_owner_type`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "sqlx", derive(sqlx::Type))]
#[cfg_attr(
    feature = "sqlx",
    sqlx(type_name = "entity_owner_type", rename_all = "lowercase")
)]
pub enum OwnerType {
    /// A Macro user.
    User,
    /// A bot.
    Bot,
    /// A team.
    Team,
}

/// Error returned when an owner principal or type string cannot be parsed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("invalid owner: {value}")]
pub struct OwnerParseError {
    value: String,
}

impl OwnerParseError {
    fn invalid(value: &str) -> Self {
        Self {
            value: value.to_string(),
        }
    }
}

impl Owner {
    /// Discriminator for this owner.
    #[must_use]
    pub fn owner_type(&self) -> OwnerType {
        match self {
            Self::User(_) => OwnerType::User,
            Self::Bot(_) => OwnerType::Bot,
            Self::Team(_) => OwnerType::Team,
        }
    }

    /// Canonical principal string for this owner.
    #[must_use]
    pub fn principal_id(&self) -> String {
        match self {
            Self::User(user_id) => user_id.to_string(),
            Self::Bot(bot_id) => bot_id.into_storage_id().to_string(),
            Self::Team(team_id) => team_id.hyphenated().to_string(),
        }
    }

    /// Parse a principal under a known [`OwnerType`].
    ///
    /// This is strict: the string must match that type's storage form.
    pub fn parse(owner_type: OwnerType, value: &str) -> Result<Self, OwnerParseError> {
        match owner_type {
            OwnerType::User => MacroUserIdStr::parse_from_str(value)
                .map(CowLike::into_owned)
                .map(Self::User)
                .map_err(|_| OwnerParseError::invalid(value)),
            OwnerType::Bot => BotIdStr::parse_from_str(value)
                .map(|bot_id| Self::Bot(bot_id.bot_id()))
                .map_err(|_| OwnerParseError::invalid(value)),
            OwnerType::Team => parse_hyphenated_uuid(value).map(Self::Team),
        }
    }

    /// Parse a principal by prefix.
    pub fn from_principal_str(value: &str) -> Result<Self, OwnerParseError> {
        if value.starts_with(USER_PRINCIPAL_PREFIX) {
            Self::parse(OwnerType::User, value)
        } else if value.starts_with(BOT_PRINCIPAL_PREFIX) {
            Self::parse(OwnerType::Bot, value)
        } else {
            Self::parse(OwnerType::Team, value)
        }
    }
}

impl From<Owner> for String {
    fn from(value: Owner) -> Self {
        value.principal_id()
    }
}

impl TryFrom<String> for Owner {
    type Error = OwnerParseError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::from_principal_str(&value)
    }
}

impl Display for OwnerType {
    fn fmt(&self, f: &mut Formatter<'_>) -> FmtResult {
        f.write_str(match self {
            Self::User => OWNER_TYPE_USER,
            Self::Bot => OWNER_TYPE_BOT,
            Self::Team => OWNER_TYPE_TEAM,
        })
    }
}

impl FromStr for OwnerType {
    type Err = OwnerParseError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            OWNER_TYPE_USER => Ok(Self::User),
            OWNER_TYPE_BOT => Ok(Self::Bot),
            OWNER_TYPE_TEAM => Ok(Self::Team),
            _ => Err(OwnerParseError::invalid(value)),
        }
    }
}

fn parse_hyphenated_uuid(value: &str) -> Result<Uuid, OwnerParseError> {
    if value.len() != TEAM_UUID_HYPHENATED_LEN {
        return Err(OwnerParseError::invalid(value));
    }
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
    {
        return Err(OwnerParseError::invalid(value));
    }
    Uuid::parse_str(value).map_err(|_| OwnerParseError::invalid(value))
}
