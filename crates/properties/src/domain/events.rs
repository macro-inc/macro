//! Kafka event models for the `macro.properties` topic.
//!
//! Property definition and option events are keyed by property definition id.
//! Entity property events are keyed by entity id to preserve per-entity ordering.

#[cfg(test)]
mod test;

use activity::Actor;
use chrono::{DateTime, Utc};
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroPropertiesTopic;
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::service::property_value::PropertyValue;
use models_properties::{DataType, EntityType, PropertyOwner};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Metadata for [`PropertyTopicEvent::Created`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PropertyCreatedMetadata {
    /// Identifier of the created property definition.
    pub property_definition_id: Uuid,
    /// Authenticated user who created the property, or `None` for a system operation.
    pub actor_user_id: Option<MacroUserIdStr<'static>>,
    /// Scope that owns the property definition.
    pub owner: PropertyOwner,
    /// Human-readable property name.
    pub display_name: String,
    /// Data type accepted by the property.
    pub data_type: DataType,
    /// Whether the property accepts multiple values.
    pub is_multi_select: bool,
    /// Entity type accepted by an entity-reference property.
    pub specific_entity_type: Option<EntityType>,
    /// Time the property definition was created.
    pub created_at: DateTime<Utc>,
}

/// Metadata for [`PropertyTopicEvent::Deleted`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PropertyDeletedMetadata {
    /// Identifier of the deleted property definition.
    pub property_definition_id: Uuid,
    /// Authenticated user who deleted the property, or `None` for a system operation.
    pub actor_user_id: Option<MacroUserIdStr<'static>>,
    /// Scope that owned the property definition.
    pub owner: PropertyOwner,
    /// Property name at deletion time.
    pub display_name: String,
    /// Property data type at deletion time.
    pub data_type: DataType,
}

/// Metadata for [`PropertyTopicEvent::OptionCreated`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PropertyOptionCreatedMetadata {
    /// Identifier of the created option.
    pub option_id: Uuid,
    /// Identifier of the option's property definition.
    pub property_definition_id: Uuid,
    /// Authenticated user who created the option, or `None` for a system operation.
    pub actor_user_id: Option<MacroUserIdStr<'static>>,
    /// Selectable option value.
    pub value: PropertyOptionValue,
    /// Optional hexadecimal display color.
    pub color: Option<String>,
    /// Option ordering position.
    pub display_order: i32,
}

/// Metadata for [`PropertyTopicEvent::OptionUpdated`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PropertyOptionUpdatedMetadata {
    /// Identifier of the updated option.
    pub option_id: Uuid,
    /// Identifier of the option's property definition.
    pub property_definition_id: Uuid,
    /// Authenticated user who updated the option, or `None` for a system operation.
    pub actor_user_id: Option<MacroUserIdStr<'static>>,
    /// Full option value after the update.
    pub value: PropertyOptionValue,
    /// Full optional display color after the update.
    pub color: Option<String>,
    /// Full ordering position after the update.
    pub display_order: i32,
}

/// Metadata for [`PropertyTopicEvent::OptionDeleted`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PropertyOptionDeletedMetadata {
    /// Identifier of the deleted option.
    pub option_id: Uuid,
    /// Identifier of the option's property definition.
    pub property_definition_id: Uuid,
    /// Authenticated user who deleted the option, or `None` for a system operation.
    pub actor_user_id: Option<MacroUserIdStr<'static>>,
    /// Option value at deletion time.
    pub value: PropertyOptionValue,
}

/// Metadata for [`PropertyTopicEvent::EntityPropertyUpdated`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EntityPropertyUpdatedMetadata {
    /// Identifier of the entity-property row.
    pub entity_property_id: Uuid,
    /// Identifier of the entity whose property changed.
    pub entity_id: String,
    /// Type of the entity whose property changed.
    pub entity_type: EntityType,
    /// Identifier of the property definition.
    pub property_definition_id: Uuid,
    /// Authenticated user who changed the value, or `None` for a system operation.
    pub actor_user_id: Option<MacroUserIdStr<'static>>,
    /// Who mechanically changed the value. Absent on events published
    /// before attribution: ingest then treats [`Self::actor_user_id`] as
    /// the actor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor: Option<Actor<'static>>,
    /// The user whose feed this change belongs on, when different from
    /// [`Self::actor`]. Absent means the actor is also the subject.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_behalf_of: Option<MacroUserIdStr<'static>>,
    /// Full value after the update, or `None` when cleared without deleting the row.
    pub value: Option<PropertyValue>,
    /// Full value before the update: `None` when the property was newly
    /// attached, when the writer couldn't capture it, or on events published
    /// before this field existed (hence the serde default).
    #[serde(default)]
    pub previous_value: Option<PropertyValue>,
    /// Time the entity-property row was updated.
    pub updated_at: DateTime<Utc>,
}

/// Metadata for [`PropertyTopicEvent::EntityPropertyDeleted`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EntityPropertyDeletedMetadata {
    /// Identifier of the deleted entity-property row.
    pub entity_property_id: Uuid,
    /// Identifier of the entity whose property was deleted.
    pub entity_id: String,
    /// Type of the entity whose property was deleted.
    pub entity_type: EntityType,
    /// Identifier of the property definition.
    pub property_definition_id: Uuid,
    /// Authenticated user who deleted the value, or `None` for a system operation.
    pub actor_user_id: Option<MacroUserIdStr<'static>>,
    /// Who mechanically deleted the value. Absent on events published
    /// before attribution: ingest then treats [`Self::actor_user_id`] as
    /// the actor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor: Option<Actor<'static>>,
    /// The user whose feed this deletion belongs on, when different from
    /// [`Self::actor`]. Absent means the actor is also the subject.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_behalf_of: Option<MacroUserIdStr<'static>>,
}

/// Metadata for [`PropertyTopicEvent::EntityPropertiesCleared`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EntityPropertiesClearedMetadata {
    /// Identifier of the entity whose properties were cleared.
    pub entity_id: String,
    /// Type of the entity whose properties were cleared.
    pub entity_type: EntityType,
    /// Authenticated user who cleared the values, or `None` for a system operation.
    pub actor_user_id: Option<MacroUserIdStr<'static>>,
    /// Who mechanically cleared the values. Absent on events published
    /// before attribution: ingest then treats [`Self::actor_user_id`] as
    /// the actor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor: Option<Actor<'static>>,
    /// The user whose feed this clear belongs on, when different from
    /// [`Self::actor`]. Absent means the actor is also the subject.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_behalf_of: Option<MacroUserIdStr<'static>>,
}

/// Property mutation events published to [`MacroPropertiesTopic`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum PropertyTopicEvent {
    /// A property definition was created.
    #[serde(rename = "property.created")]
    Created(PropertyCreatedMetadata),
    /// A property definition was deleted.
    #[serde(rename = "property.deleted")]
    Deleted(PropertyDeletedMetadata),
    /// A property option was created.
    #[serde(rename = "property_option.created")]
    OptionCreated(PropertyOptionCreatedMetadata),
    /// A property option was updated.
    #[serde(rename = "property_option.updated")]
    OptionUpdated(PropertyOptionUpdatedMetadata),
    /// A property option was deleted.
    #[serde(rename = "property_option.deleted")]
    OptionDeleted(PropertyOptionDeletedMetadata),
    /// An entity's property value was updated.
    #[serde(rename = "entity_property.updated")]
    EntityPropertyUpdated(EntityPropertyUpdatedMetadata),
    /// An entity's property value was deleted.
    #[serde(rename = "entity_property.deleted")]
    EntityPropertyDeleted(EntityPropertyDeletedMetadata),
    /// All property values on an entity were cleared.
    #[serde(rename = "entity_properties.cleared")]
    EntityPropertiesCleared(EntityPropertiesClearedMetadata),
}

impl TopicEvent for PropertyTopicEvent {
    type Topic = MacroPropertiesTopic;

    const SCHEMA_VERSION: u8 = 1;
}

/// Publishable event for [`MacroPropertiesTopic`].
pub struct PropertyMacroEvent {
    key: String,
    event: Event<PropertyTopicEvent>,
}

impl PropertyMacroEvent {
    /// Build a property-created event keyed by the bare property definition id.
    pub fn created(metadata: PropertyCreatedMetadata) -> Self {
        Self::new(
            metadata.property_definition_id.to_string(),
            PropertyTopicEvent::Created(metadata),
        )
    }

    /// Build a property-deleted event keyed by the bare property definition id.
    pub fn deleted(metadata: PropertyDeletedMetadata) -> Self {
        Self::new(
            metadata.property_definition_id.to_string(),
            PropertyTopicEvent::Deleted(metadata),
        )
    }

    /// Build an option-created event keyed by the bare property definition id.
    pub fn property_option_created(metadata: PropertyOptionCreatedMetadata) -> Self {
        Self::new(
            metadata.property_definition_id.to_string(),
            PropertyTopicEvent::OptionCreated(metadata),
        )
    }

    /// Build an option-updated event keyed by the bare property definition id.
    pub fn property_option_updated(metadata: PropertyOptionUpdatedMetadata) -> Self {
        Self::new(
            metadata.property_definition_id.to_string(),
            PropertyTopicEvent::OptionUpdated(metadata),
        )
    }

    /// Build an option-deleted event keyed by the bare property definition id.
    pub fn property_option_deleted(metadata: PropertyOptionDeletedMetadata) -> Self {
        Self::new(
            metadata.property_definition_id.to_string(),
            PropertyTopicEvent::OptionDeleted(metadata),
        )
    }

    /// Build an entity-property-updated event keyed by the bare entity id.
    pub fn entity_property_updated(metadata: EntityPropertyUpdatedMetadata) -> Self {
        Self::new(
            metadata.entity_id.clone(),
            PropertyTopicEvent::EntityPropertyUpdated(metadata),
        )
    }

    /// Build an entity-property-deleted event keyed by the bare entity id.
    pub fn entity_property_deleted(metadata: EntityPropertyDeletedMetadata) -> Self {
        Self::new(
            metadata.entity_id.clone(),
            PropertyTopicEvent::EntityPropertyDeleted(metadata),
        )
    }

    /// Build an entity-properties-cleared event keyed by the bare entity id.
    pub fn entity_properties_cleared(metadata: EntityPropertiesClearedMetadata) -> Self {
        Self::new(
            metadata.entity_id.clone(),
            PropertyTopicEvent::EntityPropertiesCleared(metadata),
        )
    }

    fn new(key: String, event: PropertyTopicEvent) -> Self {
        Self::with_event(key, Event::new(event))
    }

    fn with_event(key: String, event: Event<PropertyTopicEvent>) -> Self {
        Self { key, event }
    }
}

impl MacroEvent for PropertyMacroEvent {
    type EventPayload = PropertyTopicEvent;

    fn key(&self) -> &str {
        &self.key
    }

    fn event(&self) -> &Event<Self::EventPayload> {
        &self.event
    }

    fn from_event(key: String, event: Event<Self::EventPayload>) -> Self {
        Self::with_event(key, event)
    }
}
