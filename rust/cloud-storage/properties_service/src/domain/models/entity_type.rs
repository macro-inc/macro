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
