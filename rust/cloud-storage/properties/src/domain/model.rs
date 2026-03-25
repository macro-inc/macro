//! Domain models for properties.

use models_properties::DataType;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::service::property_value::PropertyValue;
use uuid::Uuid;

/// Summary of a property attached to an entity, including its definition and current value.
#[derive(Debug, Clone)]
pub struct EntityPropertyInfo {
    /// The property definition ID (used to set values via `set_entity_property`).
    pub property_definition_id: Uuid,
    /// Human-readable name of the property.
    pub display_name: String,
    /// The data type of the property.
    pub data_type: DataType,
    /// Whether the property supports multiple values.
    pub is_multi_select: bool,
    /// Whether this is a system-defined property.
    pub is_system: bool,
    /// The current value of the property, if set.
    pub value: Option<PropertyValue>,
    /// Available options for select-type properties.
    pub options: Vec<PropertyOptionInfo>,
}

/// A selectable option for select-type properties.
#[derive(Debug, Clone)]
pub struct PropertyOptionInfo {
    /// The option ID (used when setting select values).
    pub id: Uuid,
    /// Display order for UI rendering.
    pub display_order: i32,
    /// The option's value.
    pub value: PropertyOptionValue,
}
