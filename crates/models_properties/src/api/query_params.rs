//! API layer query parameter types.

use serde::{Deserialize, Serialize};
use serde_with::{StringWithSeparator, formats::CommaSeparator, serde_as};
use utoipa::ToSchema;

use crate::api::error::QueryParamValidationError;

/// Query parameters for entity properties endpoint.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct EntityQueryParams {
    /// Whether to include system metadata properties (default: false)
    #[serde(default)]
    pub include_metadata: bool,
}

/// Query parameters for bulk entity operations
#[serde_as]
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct BulkEntityQueryParams {
    /// Comma-separated list of entity IDs
    #[serde_as(as = "StringWithSeparator::<CommaSeparator, String>")]
    pub entity_ids: Vec<String>,
}

impl BulkEntityQueryParams {
    pub fn validate(&self) -> Result<(), QueryParamValidationError> {
        if self.entity_ids.is_empty() {
            return Err(QueryParamValidationError::EmptyEntityIds);
        }
        Ok(())
    }
}
