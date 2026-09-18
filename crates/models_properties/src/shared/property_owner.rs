//! Shared property ownership type.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

/// Defines who owns a property - user-scoped, team-scoped, database-scoped, or system.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "snake_case", tag = "scope")]
pub enum PropertyOwner {
    /// User-scoped property.
    User { user_id: String },
    /// Team-scoped property.
    Team { team_id: Uuid },
    /// Database-scoped property: the definition is a column of one Macro
    /// database and is invisible to the shared user/team property namespace.
    Database { database_id: Uuid },
    /// System-owned property (no user, team, or database owner).
    System,
}

impl PropertyOwner {
    /// Get the team_id if present.
    pub fn team_id(&self) -> Option<Uuid> {
        match self {
            PropertyOwner::Team { team_id } => Some(*team_id),
            PropertyOwner::User { .. } | PropertyOwner::Database { .. } | PropertyOwner::System => {
                None
            }
        }
    }

    /// Get the user_id if present.
    pub fn user_id(&self) -> Option<&str> {
        match self {
            PropertyOwner::User { user_id } => Some(user_id.as_str()),
            PropertyOwner::Team { .. } | PropertyOwner::Database { .. } | PropertyOwner::System => {
                None
            }
        }
    }

    /// Get the database_id if present.
    pub fn database_id(&self) -> Option<Uuid> {
        match self {
            PropertyOwner::Database { database_id } => Some(*database_id),
            PropertyOwner::User { .. } | PropertyOwner::Team { .. } | PropertyOwner::System => None,
        }
    }

    /// Create from the nullable owner columns and the is_system flag (for DB
    /// conversions). A definition is owned by exactly one of: the system, a
    /// user, a team, or a database — the `owned_by_database_or_team_or_user_or_system`
    /// CHECK constraint enforces that.
    pub fn from_optional_ids(
        team_id: Option<Uuid>,
        user_id: Option<String>,
        database_id: Option<Uuid>,
        is_system: bool,
    ) -> Self {
        if is_system {
            return PropertyOwner::System;
        }
        match (user_id, team_id, database_id) {
            (Some(user_id), _, _) => PropertyOwner::User { user_id },
            (None, Some(team_id), _) => PropertyOwner::Team { team_id },
            (None, None, Some(database_id)) => PropertyOwner::Database { database_id },
            (None, None, None) => PropertyOwner::System,
        }
    }
}
