//! Shared property ownership type.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

/// Defines who owns a property - user-scoped, team-scoped, or system.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "snake_case", tag = "scope")]
pub enum PropertyOwner {
    /// User-scoped property.
    User { user_id: String },
    /// Team-scoped property.
    Team { team_id: Uuid },
    /// System-owned property (no user or team owner).
    System,
}

impl PropertyOwner {
    /// Get the team_id if present.
    pub fn team_id(&self) -> Option<Uuid> {
        match self {
            PropertyOwner::Team { team_id } => Some(*team_id),
            PropertyOwner::User { .. } | PropertyOwner::System => None,
        }
    }

    /// Get the user_id if present.
    pub fn user_id(&self) -> Option<&str> {
        match self {
            PropertyOwner::User { user_id } => Some(user_id.as_str()),
            PropertyOwner::Team { .. } | PropertyOwner::System => None,
        }
    }

    /// Create from optional team_id, user_id, and is_system flag (for DB conversions).
    /// A definition is owned by exactly one of: the system, a user, or a team.
    pub fn from_optional_ids(
        team_id: Option<Uuid>,
        user_id: Option<String>,
        is_system: bool,
    ) -> Self {
        if is_system {
            return PropertyOwner::System;
        }
        match user_id {
            Some(user_id) => PropertyOwner::User { user_id },
            None => match team_id {
                Some(team_id) => PropertyOwner::Team { team_id },
                None => PropertyOwner::System,
            },
        }
    }
}
