#![deny(missing_docs)]

//! Harness identity primitives.
//!
//! A harness is a user-run agent runtime (a macrod daemon) registered with
//! Macro. Its id is shared by the registration API, the authorization layer,
//! and the runtime gateway, so the newtype lives in this leaf crate the way
//! [`bot_id`](https://docs.rs) does for bots, keeping those crates decoupled.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Runtime slug persisted on agents served by a registered harness.
///
/// `agent_configs.harness` keeps holding the runtime slug for built-in
/// runtimes; agents bound to a registered harness store this sentinel plus
/// the harness row id.
pub const MACROD_HARNESS_SLUG: &str = "macrod";

/// A harness id UUID.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct HarnessId(Uuid);

impl HarnessId {
    #[cfg(any(test, feature = "test-utils"))]
    #[allow(missing_docs)]
    pub const TEST_A: Self = Self(Uuid::from_u128(0x4A125A));

    #[cfg(any(test, feature = "test-utils"))]
    #[allow(missing_docs)]
    pub const TEST_B: Self = Self(Uuid::from_u128(0x4A125B));

    /// Build a harness id from its UUID.
    pub const fn new_from_uuid(id: Uuid) -> Self {
        Self(id)
    }

    /// Return the underlying UUID.
    pub const fn as_uuid(self) -> Uuid {
        self.0
    }

    /// Parse a harness id from its UUID string representation.
    pub fn parse_uuid_str(value: &str) -> Result<Self, HarnessIdParseError> {
        Uuid::parse_str(value)
            .map(Self)
            .map_err(|_| HarnessIdParseError::invalid(value))
    }
}

impl std::fmt::Display for HarnessId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::str::FromStr for HarnessId {
    type Err = HarnessIdParseError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse_uuid_str(value)
    }
}

/// Error returned when a harness id cannot be parsed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("invalid harness id: {value}")]
pub struct HarnessIdParseError {
    value: String,
}

impl HarnessIdParseError {
    fn invalid(value: &str) -> Self {
        Self {
            value: value.to_string(),
        }
    }
}

#[cfg(feature = "schema")]
impl utoipa::ToSchema for HarnessId {
    fn name() -> std::borrow::Cow<'static, str> {
        std::borrow::Cow::Borrowed("HarnessId")
    }
}

#[cfg(feature = "schema")]
impl utoipa::PartialSchema for HarnessId {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        String::schema()
    }
}

#[cfg(feature = "sqlx")]
impl sqlx::Type<sqlx::Postgres> for HarnessId {
    fn type_info() -> sqlx::postgres::PgTypeInfo {
        <Uuid as sqlx::Type<sqlx::Postgres>>::type_info()
    }

    fn compatible(ty: &sqlx::postgres::PgTypeInfo) -> bool {
        <Uuid as sqlx::Type<sqlx::Postgres>>::compatible(ty)
    }
}

#[cfg(feature = "sqlx")]
impl sqlx::postgres::PgHasArrayType for HarnessId {
    fn array_type_info() -> sqlx::postgres::PgTypeInfo {
        <Uuid as sqlx::postgres::PgHasArrayType>::array_type_info()
    }
}

#[cfg(feature = "sqlx")]
impl<'q> sqlx::Encode<'q, sqlx::Postgres> for HarnessId {
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
impl<'r> sqlx::Decode<'r, sqlx::Postgres> for HarnessId {
    fn decode(value: sqlx::postgres::PgValueRef<'r>) -> Result<Self, sqlx::error::BoxDynError> {
        let value = <Uuid as sqlx::Decode<sqlx::Postgres>>::decode(value)?;
        Ok(Self(value))
    }
}
