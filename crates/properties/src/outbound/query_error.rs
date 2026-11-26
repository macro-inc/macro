//! Typed failures of the property queries that transactional writers compose.

use models_properties::db::error::DbConversionError;

/// A property query failed; a caller's transaction is to be dropped.
#[derive(Debug, thiserror::Error)]
pub enum PropertyQueryError {
    /// A selected option no longer belongs to the property definition.
    #[error("selected option {0} no longer exists")]
    MissingOption(uuid::Uuid),
    /// Postgres rejected or failed the statement.
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    /// A stored option row holds no single typed value.
    #[error(transparent)]
    Conversion(#[from] DbConversionError),
    /// A property value did not serialize to or from JSON.
    #[error(transparent)]
    Value(#[from] serde_json::Error),
    /// An option position does not fit the `display_order` column.
    #[error("option position {0} exceeds the display order range")]
    DisplayOrderOverflow(usize),
}

/// The unique indexes that hold one definition name per owner, and one tag
/// definition per owner.
pub(super) const DEFINITION_NAME_INDEXES: [&str; 4] = [
    "unique_property_definitions_team_display_name",
    "unique_property_definitions_user_display_name",
    "uq_tag_definition_per_team",
    "uq_tag_definition_per_user",
];

/// The unique indexes that hold one option per value of a definition.
pub(super) const OPTION_VALUE_INDEXES: [&str; 2] = [
    "unique_property_options_number_value",
    "unique_property_options_string_value_sha256",
];

/// Whether Postgres refused a write for a duplicate in one of `indexes`. Any
/// other violation, such as of a primary key, stays an internal failure.
pub(super) fn violates_unique(error: &sqlx::Error, indexes: &[&str]) -> bool {
    error.as_database_error().is_some_and(|error| {
        error.is_unique_violation()
            && error
                .constraint()
                .is_some_and(|name| indexes.contains(&name))
    })
}
