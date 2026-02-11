#![deny(missing_docs)]
//! This crate provides types for entities and actions on those events that can occur in macro
//! Please avoid writing real business logic in this crate unless it is applicable specifically to only the
//! types that exist inside this crate.

use cowlike::CowLike;
use serde::{Deserialize, Serialize};
use std::{borrow::Cow, str::FromStr};
pub use strum::ParseError;
use strum::{Display, EnumString, IntoStaticStr};
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
    /// The entity is a document
    Document,
    /// The entity is a collection of other entities
    Project,
    /// The entity is an email
    Email,
    /// The entity is an email thread
    EmailThread,
    /// The entity is a team
    Team,
}

impl EntityType {
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
    // TODO: we can remove this alias after a few weeks
    #[serde(alias = "eventItemType")]
    pub entity_type: EntityType,
    /// The id of that entity
    // TODO: we can remove this alias after a few weeks
    #[serde(alias = "eventItemId")]
    pub entity_id: Cow<'a, str>,
}

impl<'a> Entity<'a> {
    /// provide a connection_id string slice to upgrade this type into a [ConnectionEntity]
    pub fn with_connection_str(self, connection_id: &'a str) -> EntityConnection<'a> {
        EntityConnection {
            extra: self,
            connection_id: Cow::Borrowed(connection_id),
        }
    }
    /// provide a connection_id string to upgrade this type into a [ConnectionEntity]
    pub fn with_connection_string(self, connection_id: String) -> EntityConnection<'a> {
        EntityConnection {
            extra: self,
            connection_id: Cow::Owned(connection_id),
        }
    }
}

/// Uniquely describes a connection to an [Entity]
#[non_exhaustive]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct EntityConnection<'a> {
    /// the [Entity] we are connected to with this connection
    #[serde(flatten)]
    pub extra: Entity<'a>,
    /// the id of this connection
    pub connection_id: Cow<'a, str>,
}

impl<'a> EntityConnection<'a> {
    /// provide a user id string slice to upgrade this type into a [NewConnectionEntity]
    pub fn with_user_str(self, user_id: &'a str) -> UserEntityConnection<'a> {
        UserEntityConnection {
            user_id: Cow::Borrowed(user_id),
            extra: self,
        }
    }
    /// provides a user id string to upgrade this type into a [NewConnectionEntity]
    pub fn with_user_string(self, user_id: String) -> UserEntityConnection<'a> {
        UserEntityConnection {
            user_id: Cow::Owned(user_id),
            extra: self,
        }
    }
}

/// Uniquely describes a user and their connection id to an [Entity]
#[non_exhaustive]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct UserEntityConnection<'a> {
    /// The user id of the connection we are describing
    pub user_id: Cow<'a, str>,
    /// the [ConnectionEntity]
    #[serde(flatten)]
    pub extra: EntityConnection<'a>,
}

/// The type of action that can occur on an [Entity]
#[derive(
    serde::Serialize,
    serde::Deserialize,
    Debug,
    ToSchema,
    Clone,
    Copy,
    Display,
    IntoStaticStr,
    EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum TrackAction {
    /// the [Entity] was opened
    Open,
    /// the [Entity] was pinged
    Ping,
    /// the [Entity] was closed
    Close,
}

/// The data that describes an action a user has taken on a document
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackingData<'a> {
    /// the [UserEntityConnection] where the event occurred
    pub entity: UserEntityConnection<'a>,
    /// the event that occurred
    pub action: TrackAction,
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

impl<'a> CowLike<'a> for EntityConnection<'a> {
    type Owned<'b> = EntityConnection<'b>;

    fn into_owned(self) -> EntityConnection<'static> {
        EntityConnection {
            extra: self.extra.into_owned(),
            connection_id: Cow::Owned(self.connection_id.into_owned()),
        }
    }

    fn copied(&'a self) -> Self {
        EntityConnection {
            extra: self.extra.copied(),
            connection_id: Cow::Borrowed(&self.connection_id),
        }
    }
}

impl<'a> CowLike<'a> for UserEntityConnection<'a> {
    type Owned<'b> = UserEntityConnection<'b>;

    fn into_owned(self) -> UserEntityConnection<'static> {
        UserEntityConnection {
            user_id: Cow::Owned(self.user_id.into_owned()),
            extra: self.extra.into_owned(),
        }
    }

    fn copied(&'a self) -> Self {
        UserEntityConnection {
            user_id: Cow::Borrowed(&self.user_id),
            extra: self.extra.copied(),
        }
    }
}

impl<'a> CowLike<'a> for TrackingData<'a> {
    type Owned<'b> = TrackingData<'b>;

    fn into_owned(self) -> TrackingData<'static> {
        TrackingData {
            entity: self.entity.into_owned(),
            action: self.action,
        }
    }

    fn copied(&'a self) -> Self {
        TrackingData {
            entity: self.entity.copied(),
            action: self.action,
        }
    }
}
