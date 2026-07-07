//! Domain models for properties.

use macro_user_id::user_id::MacroUserIdStr;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::service::property_value::PropertyValue;
use models_properties::{DataType, EntityReference, EntityType};
use uuid::Uuid;

/// Key identifying the properties attached to one entity.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct EntityPropertiesKey {
    pub entity_id: String,
    pub entity_type: EntityType,
}

impl From<&EntityReference> for EntityPropertiesKey {
    fn from(value: &EntityReference) -> Self {
        Self {
            entity_id: value.entity_id.clone(),
            entity_type: value.entity_type,
        }
    }
}

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

/// The owner of a user- or team-created property definition. Encodes the
/// "exactly one of user / team" invariant in the type, so neither a both-owners
/// nor a no-owner row is representable. System properties are not created here.
#[derive(Debug, Clone, Copy)]
pub enum PropertyDefinitionOwner<'a> {
    /// Owned by a single user.
    User(&'a str),
    /// Owned by a team.
    Team(Uuid),
}

impl<'a> PropertyDefinitionOwner<'a> {
    /// Split into the nullable (team_id, user_id) columns the row stores.
    pub fn into_ids(self) -> (Option<Uuid>, Option<&'a str>) {
        match self {
            PropertyDefinitionOwner::User(user_id) => (None, Some(user_id)),
            PropertyDefinitionOwner::Team(team_id) => (Some(team_id), None),
        }
    }
}

/// A task-assignment notification expressed in domain terms.
///
/// Outbound adapters enrich this (task name, sender profile picture) and
/// translate it to the concrete notification infrastructure, fanning out one
/// notification per recipient.
#[derive(Debug, Clone)]
pub struct TaskAssignedNotification<'a> {
    /// The task the recipients were assigned to.
    pub task_id: Uuid,
    /// The user who assigned the task.
    pub assigned_by: MacroUserIdStr<'a>,
    /// The newly assigned users to notify.
    pub recipient_ids: Vec<MacroUserIdStr<'a>>,
}
