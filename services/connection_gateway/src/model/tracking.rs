//! Types for tracking entity connections and actions

use cowlike::CowLike;
use model_entity::Entity;
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use strum::{Display, EnumString, IntoStaticStr};
use utoipa::ToSchema;

/// Uniquely describes a connection to an [Entity]
#[non_exhaustive]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct EntityConnection<'a> {
    /// the [Entity] we are connected to with this connection
    #[serde(flatten)]
    pub extra: Entity<'a>,
    /// the id of this connection
    pub connection_id: Cow<'a, str>,
}

impl<'a> EntityConnection<'a> {
    /// provide a user id string slice to upgrade this type into a [UserEntityConnection]
    pub fn with_user_str(self, user_id: &'a str) -> UserEntityConnection<'a> {
        UserEntityConnection {
            user_id: Cow::Borrowed(user_id),
            extra: self,
        }
    }
    /// provides a user id string to upgrade this type into a [UserEntityConnection]
    pub fn with_user_string(self, user_id: String) -> UserEntityConnection<'a> {
        UserEntityConnection {
            user_id: Cow::Owned(user_id),
            extra: self,
        }
    }
}

/// Uniquely describes a user and their connection id to an [Entity]
#[non_exhaustive]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct UserEntityConnection<'a> {
    /// The user id of the connection we are describing
    pub user_id: Cow<'a, str>,
    /// the [EntityConnection]
    #[serde(flatten)]
    pub extra: EntityConnection<'a>,
}

/// The type of action that can occur on an [Entity]
#[derive(
    Serialize, Deserialize, Debug, ToSchema, Clone, Copy, Display, IntoStaticStr, EnumString,
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

/// Extension trait to add connection builder methods to [Entity]
pub trait EntityConnectionExt<'a> {
    /// provide a connection_id string slice to upgrade this type into an [EntityConnection]
    fn with_connection_str(self, connection_id: &'a str) -> EntityConnection<'a>;
}

impl<'a> EntityConnectionExt<'a> for Entity<'a> {
    fn with_connection_str(self, connection_id: &'a str) -> EntityConnection<'a> {
        EntityConnection {
            extra: self,
            connection_id: Cow::Borrowed(connection_id),
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
