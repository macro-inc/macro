//! What counts as activity in the properties domain.
//!
//! Every attributed property change on an entity is activity
//! ([`CommonAction::PropertyChanged`], valid on every entity kind).
//! Property/option *definition* changes are not entity activity and are
//! dropped.

#[cfg(test)]
mod test;

use ::activity::{
    Activity, ActivitySource, Actor, CommonAction, EntityType, Ingest, PropertyChange, event_time,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::EntityType as PropertyEntityType;
use uuid::Uuid;

use super::events::PropertyTopicEvent;

/// Maps the properties-domain entity vocabulary onto the soup item-type
/// vocabulary activities use. `None` drops the activity (no soup surface).
fn entity_type(property_entity: &PropertyEntityType) -> Option<EntityType> {
    match property_entity {
        // Tasks are documents with a task sub-type.
        PropertyEntityType::Document | PropertyEntityType::Task => Some(EntityType::Document),
        PropertyEntityType::Project => Some(EntityType::Project),
        PropertyEntityType::Chat => Some(EntityType::Chat),
        PropertyEntityType::Channel => Some(EntityType::Channel),
        PropertyEntityType::Thread => Some(EntityType::EmailThread),
        PropertyEntityType::CallRecord => Some(EntityType::Call),
        PropertyEntityType::Company => Some(EntityType::CrmCompany),
        PropertyEntityType::CalendarEvent | PropertyEntityType::User => None,
    }
}

fn attributed(
    event_id: uuid::Uuid,
    actor: &Option<MacroUserIdStr<'static>>,
    property_entity: &PropertyEntityType,
    entity_id: &str,
    action: CommonAction,
    occurred_at: chrono::DateTime<chrono::Utc>,
) -> Ingest {
    let (Some(actor), Some(entity_type)) = (actor, entity_type(property_entity)) else {
        return Ingest::Ignore;
    };
    Ingest::Insert(vec![Activity::common(
        event_id,
        0,
        Actor::new_from_user(actor.clone()),
        None,
        entity_type,
        entity_id,
        action,
        occurred_at,
    )])
}

impl ActivitySource for PropertyTopicEvent {
    /// Maps one `macro.properties` event to its ingest outcome.
    ///
    /// Exhaustive on purpose: a new event variant fails compilation here
    /// until someone classifies it or explicitly drops it.
    fn ingest(&self, event_id: Uuid) -> Ingest {
        match self {
            PropertyTopicEvent::EntityPropertyUpdated(m) => attributed(
                event_id,
                &m.actor_user_id,
                &m.entity_type,
                &m.entity_id,
                CommonAction::PropertyChanged(PropertyChange {
                    property: m.property_definition_id.to_string(),
                    // None means unknown/newly-attached for `from` and
                    // cleared for `to`; a serialization failure must not
                    // masquerade as either, so it stores an explicit JSON
                    // null.
                    from: m.previous_value.as_ref().map(|value| {
                        serde_json::to_value(value).unwrap_or_else(|e| {
                            tracing::error!(error=?e, "unserializable property value");
                            serde_json::Value::Null
                        })
                    }),
                    to: m.value.as_ref().map(|value| {
                        serde_json::to_value(value).unwrap_or_else(|e| {
                            tracing::error!(error=?e, "unserializable property value");
                            serde_json::Value::Null
                        })
                    }),
                }),
                m.updated_at,
            ),
            PropertyTopicEvent::EntityPropertyDeleted(m) => attributed(
                event_id,
                &m.actor_user_id,
                &m.entity_type,
                &m.entity_id,
                CommonAction::PropertyChanged(PropertyChange {
                    property: m.property_definition_id.to_string(),
                    from: None,
                    to: None,
                }),
                event_time(event_id),
            ),
            // A bulk clear has no per-property detail; it is still an attributed
            // mutation of the entity.
            PropertyTopicEvent::EntityPropertiesCleared(m) => attributed(
                event_id,
                &m.actor_user_id,
                &m.entity_type,
                &m.entity_id,
                CommonAction::Edited,
                event_time(event_id),
            ),
            // Definition/option lifecycle is not entity activity.
            PropertyTopicEvent::Created(_)
            | PropertyTopicEvent::Deleted(_)
            | PropertyTopicEvent::OptionCreated(_)
            | PropertyTopicEvent::OptionUpdated(_)
            | PropertyTopicEvent::OptionDeleted(_) => Ingest::Ignore,
        }
    }
}
