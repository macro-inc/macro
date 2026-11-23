#![deny(missing_docs)]

//! Shared computer identity primitive.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A computer id UUID.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ComputerId(Uuid);

impl ComputerId {
    /// Build a computer id from its UUID.
    pub const fn new_from_uuid(id: Uuid) -> Self {
        Self(id)
    }

    /// Return the underlying UUID.
    pub const fn as_uuid(self) -> Uuid {
        self.0
    }

    /// Parse a computer id from its UUID string representation.
    pub fn parse_uuid_str(value: &str) -> Result<Self, ComputerIdParseError> {
        Uuid::parse_str(value)
            .map(Self)
            .map_err(|_| ComputerIdParseError::invalid(value))
    }
}

impl std::fmt::Display for ComputerId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::str::FromStr for ComputerId {
    type Err = ComputerIdParseError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse_uuid_str(value)
    }
}

/// Error returned when a computer id cannot be parsed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("invalid computer id: {value}")]
pub struct ComputerIdParseError {
    value: String,
}

impl ComputerIdParseError {
    fn invalid(value: &str) -> Self {
        Self {
            value: value.to_string(),
        }
    }
}

#[cfg(feature = "schema")]
impl utoipa::ToSchema for ComputerId {
    fn name() -> std::borrow::Cow<'static, str> {
        std::borrow::Cow::Borrowed("ComputerId")
    }
}

#[cfg(feature = "schema")]
impl utoipa::PartialSchema for ComputerId {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        String::schema()
    }
}

#[cfg(feature = "sqlx")]
impl sqlx::Type<sqlx::Postgres> for ComputerId {
    fn type_info() -> sqlx::postgres::PgTypeInfo {
        <Uuid as sqlx::Type<sqlx::Postgres>>::type_info()
    }

    fn compatible(ty: &sqlx::postgres::PgTypeInfo) -> bool {
        <Uuid as sqlx::Type<sqlx::Postgres>>::compatible(ty)
    }
}

#[cfg(feature = "sqlx")]
impl sqlx::postgres::PgHasArrayType for ComputerId {
    fn array_type_info() -> sqlx::postgres::PgTypeInfo {
        <Uuid as sqlx::postgres::PgHasArrayType>::array_type_info()
    }
}

#[cfg(feature = "sqlx")]
impl<'q> sqlx::Encode<'q, sqlx::Postgres> for ComputerId {
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
impl<'r> sqlx::Decode<'r, sqlx::Postgres> for ComputerId {
    fn decode(value: sqlx::postgres::PgValueRef<'r>) -> Result<Self, sqlx::error::BoxDynError> {
        let value = <Uuid as sqlx::Decode<sqlx::Postgres>>::decode(value)?;
        Ok(Self(value))
    }
}
