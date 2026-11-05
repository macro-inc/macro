#![deny(missing_docs)]

//! Validated Stripe price identifiers shared across billing domains.

#[cfg(test)]
mod test;

/// A non-empty Stripe price identifier starting with `price_`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(try_from = "String", into = "String"))]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(value_type = String))]
pub struct StripePriceId(String);

impl StripePriceId {
    /// Parse a non-empty identifier starting with `price_`.
    pub fn parse(value: &str) -> Result<Self, StripePriceIdParseError> {
        if !value.starts_with("price_") {
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

/// An identifier that does not satisfy Stripe's price prefix rule.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum StripePriceIdParseError {
    /// A price id must be non-empty and start with `price_`.
    #[error("Stripe price_id must be non-empty and start with price_")]
    InvalidPrefix,
}
