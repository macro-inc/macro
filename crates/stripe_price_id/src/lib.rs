#![deny(missing_docs)]

//! Validated Stripe price identifiers shared across billing domains.

#[cfg(test)]
mod test;

/// A Stripe price identifier with a 1–64 character ASCII alphanumeric or underscore suffix.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(transparent))]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(value_type = String))]
pub struct StripePriceId(String);

impl StripePriceId {
    /// Parse an identifier matching `^price_[A-Za-z0-9_]{1,64}$`.
    pub fn parse(value: &str) -> Result<Self, StripePriceIdParseError> {
        if !lazy_regex::regex_is_match!(r"^price_[A-Za-z0-9_]{1,64}$", value) {
            return Err(StripePriceIdParseError::InvalidPrefix);
        }
        Ok(Self(value.to_owned()))
    }

    /// Borrow the validated identifier.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Take the validated identifier.
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl TryFrom<String> for StripePriceId {
    type Error = StripePriceIdParseError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(&value)
    }
}

impl From<StripePriceId> for String {
    fn from(value: StripePriceId) -> Self {
        value.into_inner()
    }
}

impl std::fmt::Display for StripePriceId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// An identifier that does not satisfy the Stripe price identifier shape.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum StripePriceIdParseError {
    /// A price id must have the `price_` prefix and a 1–64 character safe suffix.
    #[error("Stripe price_id must match ^price_[A-Za-z0-9_]{{1,64}}$")]
    InvalidPrefix,
}

#[cfg(feature = "sqlx")]
impl sqlx::Type<sqlx::Postgres> for StripePriceId {
    fn type_info() -> sqlx::postgres::PgTypeInfo {
        <String as sqlx::Type<sqlx::Postgres>>::type_info()
    }
    fn compatible(ty: &sqlx::postgres::PgTypeInfo) -> bool {
        <String as sqlx::Type<sqlx::Postgres>>::compatible(ty)
    }
}

#[cfg(feature = "sqlx")]
impl<'q> sqlx::Encode<'q, sqlx::Postgres> for StripePriceId {
    fn encode_by_ref(
        &self,
        buf: &mut sqlx::postgres::PgArgumentBuffer,
    ) -> Result<sqlx::encode::IsNull, sqlx::error::BoxDynError> {
        <String as sqlx::Encode<sqlx::Postgres>>::encode_by_ref(&self.0, buf)
    }
}

#[cfg(feature = "sqlx")]
impl<'r> sqlx::Decode<'r, sqlx::Postgres> for StripePriceId {
    fn decode(value: sqlx::postgres::PgValueRef<'r>) -> Result<Self, sqlx::error::BoxDynError> {
        let value = <String as sqlx::Decode<sqlx::Postgres>>::decode(value)?;
        Ok(Self::parse(&value)?)
    }
}

#[cfg(feature = "serde")]
impl<'de> serde::Deserialize<'de> for StripePriceId {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::try_from(<String as serde::Deserialize>::deserialize(deserializer)?)
            .map_err(serde::de::Error::custom)
    }
}
