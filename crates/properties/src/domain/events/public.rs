//! The public projection of `macro.properties` events: thin payloads that
//! name what changed; entity property values travel because whoever can see
//! the entity can read them.

use activity::Actor;
use chrono::{DateTime, Utc};
use macro_event_broker::exposure::EntityType as MacroEntityType;
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::EntityType;
use models_properties::service::property_value::PropertyValue;
use serde::Serialize;
use uuid::Uuid;

/// The Macro entity a property belongs to, as the public and access
/// vocabulary names it. `None` for entity types with no accessor list
/// (calendar events and users), whose property events stay internal.
pub(crate) fn public_entity_type(entity_type: EntityType) -> Option<MacroEntityType> {
    match entity_type {
        EntityType::CallRecord => Some(MacroEntityType::Call),
        EntityType::Channel => Some(MacroEntityType::Channel),
        EntityType::Chat => Some(MacroEntityType::Chat),
        EntityType::Company => Some(MacroEntityType::CrmCompany),
        EntityType::Contact => Some(MacroEntityType::CrmContact),
        EntityType::DatabaseRow => Some(MacroEntityType::DatabaseRow),
        // Tasks are documents.
        EntityType::Document | EntityType::Task => Some(MacroEntityType::Document),
        EntityType::Initiative => Some(MacroEntityType::Initiative),
        EntityType::Project => Some(MacroEntityType::Project),
        EntityType::Thread => Some(MacroEntityType::EmailThread),
        EntityType::CalendarEvent | EntityType::User => None,
    }
}

/// The principal that acted, from the attributed actor or, on events
/// published before attribution, the authenticated user.
pub(crate) fn acting(
    actor: Option<&Actor<'static>>,
    actor_user_id: Option<&MacroUserIdStr<'static>>,
) -> Option<Actor<'static>> {
    actor
        .cloned()
        .or_else(|| actor_user_id.cloned().map(Actor::new_from_user))
}

/// Public payload of `entity_property.updated`: which property of which
/// entity changed, by whom, from what to what. Property values are small
/// structured data that whoever can see the entity can read.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PublicEntityPropertyUpdated {
    /// The entity-property row.
    pub entity_property_id: Uuid,
    /// Type of the entity carrying the property.
    pub entity_type: MacroEntityType,
    /// The entity carrying the property.
    pub entity_id: String,
    /// The property definition whose value changed.
    pub property_definition_id: Uuid,
    /// Who changed it, when attributable.
    #[cfg_attr(feature = "inbound", schema(value_type = Option<String>))]
    pub actor: Option<Actor<'static>>,
    /// The user the actor acted for, when different from the actor.
    #[cfg_attr(feature = "inbound", schema(value_type = Option<String>))]
    pub on_behalf_of: Option<MacroUserIdStr<'static>>,
    /// The value after the change; `None` when cleared without removing the
    /// row.
    pub value: Option<PropertyValue>,
    /// The value before the change; `None` when newly attached or not
    /// captured.
    pub previous_value: Option<PropertyValue>,
    /// When the value changed.
    pub updated_at: DateTime<Utc>,
}

/// Public payload of `entity_properties.cleared`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PublicEntityPropertiesCleared {
    /// Type of the entity whose properties were cleared.
    pub entity_type: MacroEntityType,
    /// The entity whose properties were cleared.
    pub entity_id: String,
    /// Who cleared them, when attributable.
    #[cfg_attr(feature = "inbound", schema(value_type = Option<String>))]
    pub actor: Option<Actor<'static>>,
    /// The user the actor acted for, when different from the actor.
    #[cfg_attr(feature = "inbound", schema(value_type = Option<String>))]
    pub on_behalf_of: Option<MacroUserIdStr<'static>>,
}

/// The public projection of
/// [`PropertyTopicEvent`](super::PropertyTopicEvent), delivered under the
/// same event names.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(tag = "event_type", content = "metadata")]
pub enum PropertyPublicEvent {
    /// A property value on an entity was set or changed.
    #[serde(rename = "entity_property.updated")]
    EntityPropertyUpdated(PublicEntityPropertyUpdated),
    /// Every property value on an entity was removed.
    #[serde(rename = "entity_properties.cleared")]
    EntityPropertiesCleared(PublicEntityPropertiesCleared),
}
