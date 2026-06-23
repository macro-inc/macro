#![deny(missing_docs)]
//! This crate provides types for entities and actions on those events that can occur in macro
//! Please avoid writing real business logic in this crate unless it is applicable specifically to only the
//! types that exist inside this crate.

use cowlike::CowLike;
use serde::{Deserialize, Serialize};
use std::{borrow::Cow, str::FromStr};
pub use strum::ParseError;
use strum::{AsRefStr, Display, EnumString, IntoStaticStr};
use utoipa::ToSchema;

#[cfg(test)]
mod tests;

/// The type of an entity in Macro
#[derive(
    Debug,
    Clone,
    Copy,
    Serialize,
    Deserialize,
    Display,
    PartialEq,
    EnumString,
    Hash,
    ToSchema,
    Eq,
    IntoStaticStr,
    AsRefStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum EntityType {
    /// The entity is a user
    User,
    /// The entity is an AI Chat session
    Chat,
    /// The entity is a channel (slack-like) conversation
    Channel,
    /// The entity is a message in a channel
    ChannelMessage,
    /// The entity is a document
    Document,
    /// The entity is a collection of other entities
    Project,
    /// The entity is an email thread
    EmailThread,
    /// The entity is a team
    Team,
    /// The entity is a voice/video call
    Call,
    /// The entity is a foreign entity stored from an external system
    ForeignEntity,
    /// A public file in the static file service
    StaticFile,
    /// The entity is a CRM company tracked by a team
    CrmCompany,
    /// The entity is a CRM contact tracked by a team
    CrmContact,
}

impl EntityType {
    /// Returns if the given entity type is a valid entity that is stored in
    /// entity_access
    pub fn is_valid_entity_access_entity(&self) -> bool {
        match self {
            EntityType::User => false,
            EntityType::Team => false,
            EntityType::Channel | EntityType::ChannelMessage => false,
            EntityType::Chat => true,
            EntityType::Document => true,
            EntityType::Project => true,
            EntityType::EmailThread => true,
            // Calls are handled by entity_access by resolving through the call's
            // owning channel (access is inherited from channel membership).
            EntityType::Call => true,
            EntityType::ForeignEntity => false,
            EntityType::StaticFile => false,
            // CRM companies/contacts derive access via team membership joins
            // — they aren't rows in the `entity_access` table.
            EntityType::CrmCompany => false,
            EntityType::CrmContact => false,
        }
    }
    /// provide an entity string slice to upgrade this type into an [Entity]
    pub fn with_entity_str<'a>(self, entity_id: &'a str) -> Entity<'a> {
        Entity {
            entity_type: self,
            entity_id: Cow::Borrowed(entity_id),
        }
    }
    /// provide an entity string to upgrade this type into an [Entity]
    pub fn with_entity_string(self, entity_id: String) -> Entity<'static> {
        Entity {
            entity_type: self,
            entity_id: Cow::Owned(entity_id),
        }
    }
}

impl TryFrom<String> for EntityType {
    type Error = strum::ParseError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        EntityType::from_str(&value)
    }
}

/// The Entity describes the minimum amount of information required to describe a unique thing in Macro
/// This contains the type of the entity [EntityType] and the string id of that entity
#[non_exhaustive]
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, ToSchema, Hash, PartialEq, Eq)]
pub struct Entity<'a> {
    /// The type of entity we are describing
    pub entity_type: EntityType,
    /// The id of that entity
    pub entity_id: Cow<'a, str>,
}

impl<'a> CowLike<'a> for Entity<'a> {
    type Owned<'b> = Entity<'b>;

    fn into_owned(self) -> Entity<'static> {
        Entity {
            entity_type: self.entity_type,
            entity_id: Cow::Owned(self.entity_id.into_owned()),
        }
    }

    fn copied(&'a self) -> Self {
        Entity {
            entity_type: self.entity_type,
            entity_id: Cow::Borrowed(&self.entity_id),
        }
    }
}
