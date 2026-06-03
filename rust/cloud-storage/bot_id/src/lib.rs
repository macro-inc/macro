#![deny(missing_docs)]

//! Bot identity primitives.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

const BOT_STORAGE_PREFIX: &str = "bot|";

/// Stable UUID for the first-party "Macro AI" system bot.
///
/// This id is seeded by a migration and referenced directly by services so
/// that Macro AI can be recognized without a database lookup.
pub const MACRO_AI_BOT_UUID: Uuid = Uuid::from_u128(0x0000_0000_0000_0000_0000_0000_0000_a1a1);

/// Stable [`BotId`] for the first-party "Macro AI" system bot.
pub const MACRO_AI_BOT_ID: BotId = BotId::from_uuid(MACRO_AI_BOT_UUID);

/// Stable handle for the "Macro AI" system bot (used for `@` mentions).
pub const MACRO_AI_HANDLE: &str = "macro";

/// Display name for the "Macro" system bot.
pub const MACRO_AI_NAME: &str = "Macro";

/// A bot id.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct BotId(Uuid);

impl BotId {
    /// Build a bot id from its UUID.
    pub const fn from_uuid(id: Uuid) -> Self {
        Self(id)
    }

    /// Return the underlying UUID.
    pub const fn as_uuid(self) -> Uuid {
        self.0
    }

    /// Parse a bot id from its UUID string representation.
    pub fn parse_uuid_str(value: &str) -> Result<Self, BotIdParseError> {
        Uuid::parse_str(value)
            .map(Self)
            .map_err(|_| BotIdParseError::invalid(value))
    }

    /// Parse the existing storage principal representation, `bot|<uuid>`.
    pub fn parse_storage_str(value: &str) -> Result<Self, BotIdParseError> {
        let Some(id) = value.strip_prefix(BOT_STORAGE_PREFIX) else {
            return Err(BotIdParseError::invalid(value));
        };
        Self::parse_uuid_str(id).map_err(|_| BotIdParseError::invalid(value))
    }

    /// Canonical storage representation for existing TEXT sender/participant columns.
    pub fn to_storage_string(self) -> String {
        format!("{BOT_STORAGE_PREFIX}{}", self.0)
    }
}

impl From<Uuid> for BotId {
    fn from(value: Uuid) -> Self {
        Self::from_uuid(value)
    }
}

impl From<BotId> for Uuid {
    fn from(value: BotId) -> Self {
        value.as_uuid()
    }
}

impl std::fmt::Display for BotId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::str::FromStr for BotId {
    type Err = BotIdParseError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse_uuid_str(value)
    }
}

/// Error returned when a bot id cannot be parsed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("invalid bot id: {value}")]
pub struct BotIdParseError {
    value: String,
}

impl BotIdParseError {
    fn invalid(value: &str) -> Self {
        Self {
            value: value.to_string(),
        }
    }
}

#[cfg(feature = "schema")]
impl utoipa::ToSchema for BotId {
    fn name() -> std::borrow::Cow<'static, str> {
        std::borrow::Cow::Borrowed("BotId")
    }
}

#[cfg(feature = "schema")]
impl utoipa::PartialSchema for BotId {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        String::schema()
    }
}

#[cfg(feature = "sqlx")]
impl sqlx::Type<sqlx::Postgres> for BotId {
    fn type_info() -> sqlx::postgres::PgTypeInfo {
        <Uuid as sqlx::Type<sqlx::Postgres>>::type_info()
    }

    fn compatible(ty: &sqlx::postgres::PgTypeInfo) -> bool {
        <Uuid as sqlx::Type<sqlx::Postgres>>::compatible(ty)
    }
}

#[cfg(feature = "sqlx")]
impl sqlx::postgres::PgHasArrayType for BotId {
    fn array_type_info() -> sqlx::postgres::PgTypeInfo {
        <Uuid as sqlx::postgres::PgHasArrayType>::array_type_info()
    }
}

#[cfg(feature = "sqlx")]
impl<'q> sqlx::Encode<'q, sqlx::Postgres> for BotId {
    fn encode_by_ref(
        &self,
        buf: &mut sqlx::postgres::PgArgumentBuffer,
    ) -> Result<sqlx::encode::IsNull, sqlx::error::BoxDynError> {
        <Uuid as sqlx::Encode<sqlx::Postgres>>::encode_by_ref(&self.0, buf)
    }

    fn size_hint(&self) -> usize {
        <Uuid as sqlx::Encode<sqlx::Postgres>>::size_hint(&self.0)
    }
}

#[cfg(feature = "sqlx")]
impl<'r> sqlx::Decode<'r, sqlx::Postgres> for BotId {
    fn decode(value: sqlx::postgres::PgValueRef<'r>) -> Result<Self, sqlx::error::BoxDynError> {
        let value = <Uuid as sqlx::Decode<sqlx::Postgres>>::decode(value)?;
        Ok(Self(value))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_string_round_trips() {
        let uuid = Uuid::new_v4();
        let bot_id = BotId::from_uuid(uuid);

        assert_eq!(
            BotId::parse_storage_str(&bot_id.to_storage_string()).unwrap(),
            bot_id
        );
    }

    #[test]
    fn rejects_non_bot_storage_string() {
        assert!(BotId::parse_storage_str("macro|teo@macro.com").is_err());
    }
}
