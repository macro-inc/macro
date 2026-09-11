#![deny(missing_docs)]

//! Contains common models for entity_access_management that need to be shared across multiple crates.

/// Entity access source type
#[derive(Debug, Clone, Copy, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "db", derive(sqlx::Type))]
#[cfg_attr(
    feature = "db",
    sqlx(type_name = "entity_access_source_type", rename_all = "lowercase")
)]
pub enum EntityAccessSourceType {
    /// Channel source
    Channel,
    /// Team source
    Team,
    /// User source
    User,
}
