//! Soup property model - simplified property representation for the Soup API.

use models_properties::service::{
    entity_property_with_definition::EntityPropertyWithDefinition,
    property_definition::PropertyDefinition, property_value::PropertyValue,
};
use serde::{Deserialize, Serialize};

/// A property attached to a Soup item.
///
/// This is a simplified representation that includes only the definition and value,
/// omitting the entity property assignment metadata and options.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SoupProperty {
    /// The property definition
    pub definition: PropertyDefinition,

    /// The property value, if set
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<PropertyValue>,
}

impl From<EntityPropertyWithDefinition> for SoupProperty {
    /// Converts from the full entity property representation.
    ///
    /// Note: The `options` field from `EntityPropertyWithDefinition` is intentionally
    /// omitted as Soup items only need the definition and current value. Select options
    /// should be fetched separately when needed for editing UI.
    fn from(prop: EntityPropertyWithDefinition) -> Self {
        Self {
            definition: prop.definition,
            value: prop.value,
        }
    }
}
