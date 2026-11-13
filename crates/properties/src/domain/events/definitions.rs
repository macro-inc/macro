//! Exposure of property definition and option events: who owns the
//! definition decides who hears about it.

use chrono::{DateTime, Utc};
use macro_event_broker::exposure::{
    Audience, EntityRef, EntityType, Exposure, ExposureError, MinTeamRole, PublicEntityType,
    PublicEvent, Stage, parse_user_id,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::{DataType, PropertyOwner};
use serde::Serialize;
use std::borrow::Cow;
use uuid::Uuid;

use super::{PropertyPublicEvent, PropertyTopicEvent};

/// Public payload of `property.created`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PublicPropertyCreated {
    /// The property definition.
    pub property_definition_id: Uuid,
    /// The user, team or database that owns it.
    pub owner: PropertyOwner,
    /// Display name.
    pub display_name: String,
    /// Accepted data type.
    pub data_type: DataType,
    /// Whether it accepts several values.
    pub is_multi_select: bool,
    /// Who created it, absent for a system operation.
    #[cfg_attr(feature = "inbound", schema(value_type = Option<String>))]
    pub actor: Option<MacroUserIdStr<'static>>,
    /// When it was created.
    pub created_at: DateTime<Utc>,
}

/// Public payload of `property.deleted`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PublicPropertyDeleted {
    /// The deleted property definition.
    pub property_definition_id: Uuid,
    /// The user, team or database that owned it.
    pub owner: PropertyOwner,
    /// Display name at deletion.
    pub display_name: String,
    /// Data type at deletion.
    pub data_type: DataType,
    /// Who deleted it, absent for a system operation.
    #[cfg_attr(feature = "inbound", schema(value_type = Option<String>))]
    pub actor: Option<MacroUserIdStr<'static>>,
}

/// Public payload of `property_option.created` and `property_option.updated`:
/// the option as it now is.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PublicPropertyOption {
    /// The option.
    pub option_id: Uuid,
    /// Its property definition.
    pub property_definition_id: Uuid,
    /// Who changed it, absent for a system operation.
    #[cfg_attr(feature = "inbound", schema(value_type = Option<String>))]
    pub actor: Option<MacroUserIdStr<'static>>,
    /// The selectable value.
    pub value: PropertyOptionValue,
    /// Display color, when set.
    pub color: Option<String>,
    /// Ordering position.
    pub display_order: i32,
}

/// Public payload of `property_option.deleted`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PublicPropertyOptionDeleted {
    /// The deleted option.
    pub option_id: Uuid,
    /// Its property definition.
    pub property_definition_id: Uuid,
    /// Who deleted it, absent for a system operation.
    #[cfg_attr(feature = "inbound", schema(value_type = Option<String>))]
    pub actor: Option<MacroUserIdStr<'static>>,
}

const SYSTEM_OWNED: &str = "system property definitions belong to no user, team or database";
const OWNER_NOT_RECORDED: &str =
    "option events published before options carried their definition's owner";

/// The exposure of a definition or option event. Entity property events are
/// not handled here and are rejected as internal.
pub(super) fn exposure(
    event: &PropertyTopicEvent,
) -> Result<Exposure<'_, PropertyPublicEvent>, ExposureError> {
    let (name, definition_id, owner, payload) = match event {
        PropertyTopicEvent::Created(m) => (
            "property.created",
            m.property_definition_id,
            Some(&m.owner),
            PropertyPublicEvent::PropertyCreated(PublicPropertyCreated {
                property_definition_id: m.property_definition_id,
                owner: m.owner.clone(),
                display_name: m.display_name.clone(),
                data_type: m.data_type,
                is_multi_select: m.is_multi_select,
                actor: m.actor_user_id.clone(),
                created_at: m.created_at,
            }),
        ),
        PropertyTopicEvent::Deleted(m) => (
            "property.deleted",
            m.property_definition_id,
            Some(&m.owner),
            PropertyPublicEvent::PropertyDeleted(PublicPropertyDeleted {
                property_definition_id: m.property_definition_id,
                owner: m.owner.clone(),
                display_name: m.display_name.clone(),
                data_type: m.data_type,
                actor: m.actor_user_id.clone(),
            }),
        ),
        PropertyTopicEvent::OptionCreated(m) => (
            "property_option.created",
            m.property_definition_id,
            m.owner.as_ref(),
            PropertyPublicEvent::OptionCreated(PublicPropertyOption {
                option_id: m.option_id,
                property_definition_id: m.property_definition_id,
                actor: m.actor_user_id.clone(),
                value: m.value.clone(),
                color: m.color.clone(),
                display_order: m.display_order,
            }),
        ),
        PropertyTopicEvent::OptionUpdated(m) => (
            "property_option.updated",
            m.property_definition_id,
            m.owner.as_ref(),
            PropertyPublicEvent::OptionUpdated(PublicPropertyOption {
                option_id: m.option_id,
                property_definition_id: m.property_definition_id,
                actor: m.actor_user_id.clone(),
                value: m.value.clone(),
                color: m.color.clone(),
                display_order: m.display_order,
            }),
        ),
        PropertyTopicEvent::OptionDeleted(m) => (
            "property_option.deleted",
            m.property_definition_id,
            m.owner.as_ref(),
            PropertyPublicEvent::OptionDeleted(PublicPropertyOptionDeleted {
                option_id: m.option_id,
                property_definition_id: m.property_definition_id,
                actor: m.actor_user_id.clone(),
            }),
        ),
        PropertyTopicEvent::EntityPropertyUpdated(_)
        | PropertyTopicEvent::EntityPropertyDeleted(_)
        | PropertyTopicEvent::EntityPropertiesCleared(_) => {
            return Ok(Exposure::internal_by_design(
                "entity property events are declared by the entity property family",
            ));
        }
    };
    let Some(owner) = owner else {
        return Ok(Exposure::internal_by_design(OWNER_NOT_RECORDED));
    };
    let audience = match owner {
        // A user's own definitions (such as their personal labels) are
        // theirs alone: never their teams' webhooks.
        PropertyOwner::User { user_id } => Audience::Recipient {
            user_id: parse_user_id(user_id)?,
        },
        PropertyOwner::Team { team_id } => Audience::Team {
            team_id: *team_id,
            min_role: MinTeamRole::Member,
        },
        // A database column is visible to whoever can see the database.
        PropertyOwner::Database { database_id } => Audience::Entity {
            entity_type: EntityType::Database,
            entity_id: database_id.to_string(),
        },
        PropertyOwner::System => return Ok(Exposure::internal_by_design(SYSTEM_OWNED)),
    };
    Ok(Exposure::Public(PublicEvent {
        name,
        entity: EntityRef::new(PublicEntityType::Property, definition_id.to_string()),
        audience,
        stage: Stage::Preview,
        payload: Cow::Owned(payload),
    }))
}
