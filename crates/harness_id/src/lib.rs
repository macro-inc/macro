#![deny(missing_docs)]

//! Harness identity primitives.
//!
//! A harness is a user-run agent runtime (a macrod daemon) registered with
//! Macro. Its id is shared by the registration API, the authorization layer,
//! and the runtime gateway, so the newtype lives in this leaf crate the way
//! [`bot_id`](https://docs.rs) does for bots, keeping those crates decoupled.

use nutype::nutype;
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
#[nutype(
    const_fn,
    derive(
        Debug,
        Clone,
        Copy,
        PartialEq,
        Eq,
        Hash,
        Display,
        Serialize,
        Deserialize
    ),
    cfg_attr(feature = "sqlx", derive_unchecked(sqlx::Type))
)]
#[cfg_attr(feature = "sqlx", sqlx(transparent))]
pub struct HarnessId(Uuid);

impl HarnessId {
    #[cfg(any(test, feature = "test-utils"))]
    #[allow(missing_docs)]
    pub const TEST_A: Self = Self::new(Uuid::from_u128(0x4A125A));

    #[cfg(any(test, feature = "test-utils"))]
    #[allow(missing_docs)]
    pub const TEST_B: Self = Self::new(Uuid::from_u128(0x4A125B));

    /// Build a harness id from its UUID.
    pub const fn new_from_uuid(id: Uuid) -> Self {
        Self::new(id)
    }

    /// Return the underlying UUID.
    pub fn as_uuid(self) -> Uuid {
        self.into_inner()
    }

    /// Parse a harness id from its UUID string representation.
    pub fn parse_uuid_str(value: &str) -> Result<Self, HarnessIdParseError> {
        Uuid::parse_str(value)
            .map(Self::new)
            .map_err(|_| HarnessIdParseError::invalid(value))
    }
}

// Hand-written rather than nutype's `FromStr`: callers match on this error's
// message, and nutype's generated error would wrap `uuid::Error` instead.
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

// Hand-written: `#[derive(utoipa::ToSchema)]` would copy the doc comment into
// the schema as a `description`, changing the published OpenAPI.
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
