//! Entity type shared across database, service, and API layers.

use serde::{Deserialize, Serialize};
use std::fmt;
use utoipa::ToSchema;

/// Type of entity that can be referenced by entity properties.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema, PartialEq, Eq, Hash, sqlx::Type)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[sqlx(
    type_name = "property_entity_type",
    rename_all = "SCREAMING_SNAKE_CASE"
)]
pub enum EntityType {
    Channel,
    Chat,
    Document,
    Project,
    Thread,
    User,
}

impl fmt::Display for EntityType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EntityType::Channel => write!(f, "channel"),
            EntityType::Chat => write!(f, "chat"),
            EntityType::Document => write!(f, "document"),
            EntityType::Project => write!(f, "project"),
            EntityType::Thread => write!(f, "thread"),
            EntityType::User => write!(f, "user"),
        }
    }
}
