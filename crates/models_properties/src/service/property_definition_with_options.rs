//! Service layer property definition with associated options composite model.

use serde::{Deserialize, Serialize};

use super::property_definition::PropertyDefinition;
use super::property_option::PropertyOption;

/// Property definition with its associated options (service representation).
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct PropertyDefinitionWithOptions {
    pub definition: PropertyDefinition,
    pub property_options: Vec<PropertyOption>,
}

// ===== Conversions =====

impl From<PropertyDefinitionWithOptions> for crate::api::PropertyDefinitionWithOptionsResponse {
    fn from(svc: PropertyDefinitionWithOptions) -> Self {
        Self {
            definition: svc.definition.into(),
            property_options: svc.property_options.into_iter().map(Into::into).collect(),
        }
    }
}
