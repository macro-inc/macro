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
