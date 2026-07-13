//! Entity type shared across database, service, and API layers.

use document_sub_type::DocumentSubType;
use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr};
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
    Company,
    Document,
    Project,
    Task,
    Thread,
    User,
}

impl fmt::Display for EntityType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EntityType::Channel => write!(f, "channel"),
            EntityType::Chat => write!(f, "chat"),
            EntityType::Company => write!(f, "company"),
            EntityType::Document => write!(f, "document"),
            EntityType::Project => write!(f, "project"),
            EntityType::Task => write!(f, "task"),
            EntityType::Thread => write!(f, "thread"),
            EntityType::User => write!(f, "user"),
        }
    }
}

#[derive(Debug, Clone, thiserror::Error)]
#[error("No conversion from {0}")]
pub struct NoConversion(pub String);

impl FromStr for EntityType {
    type Err = NoConversion;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "channel" => Ok(Self::Channel),
            "chat" => Ok(Self::Chat),
            "company" => Ok(Self::Company),
            "document" => Ok(Self::Document),
            "project" => Ok(Self::Project),
            "task" => Ok(Self::Task),
            "thread" => Ok(Self::Thread),
            "user" => Ok(Self::User),
            other => Err(NoConversion(other.to_owned())),
        }
    }
}

impl From<DocumentSubType> for EntityType {
    fn from(sub_type: DocumentSubType) -> Self {
        match sub_type {
            DocumentSubType::Task => EntityType::Task,
            // No dedicated property entity type for snippets; they key under Document.
            DocumentSubType::Snippet => EntityType::Document,
        }
    }
}
