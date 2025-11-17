//! Entity types that can have properties

use serde::{Deserialize, Serialize};
use std::fmt;

/// Type of entity that can be referenced by entity properties
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
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

// ===== Conversions to/from models_properties =====

impl From<models_properties::EntityType> for EntityType {
    fn from(external: models_properties::EntityType) -> Self {
        match external {
            models_properties::EntityType::Channel => EntityType::Channel,
            models_properties::EntityType::Chat => EntityType::Chat,
            models_properties::EntityType::Document => EntityType::Document,
            models_properties::EntityType::Project => EntityType::Project,
            models_properties::EntityType::Thread => EntityType::Thread,
            models_properties::EntityType::User => EntityType::User,
        }
    }
}

impl From<EntityType> for models_properties::EntityType {
    fn from(domain: EntityType) -> Self {
        match domain {
            EntityType::Channel => models_properties::EntityType::Channel,
            EntityType::Chat => models_properties::EntityType::Chat,
            EntityType::Document => models_properties::EntityType::Document,
            EntityType::Project => models_properties::EntityType::Project,
            EntityType::Thread => models_properties::EntityType::Thread,
            EntityType::User => models_properties::EntityType::User,
        }
    }
}
