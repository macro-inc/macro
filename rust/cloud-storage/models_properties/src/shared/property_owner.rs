//! Shared property ownership type.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Defines who owns a property - user-scoped, org-scoped, system, or both user and org.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "snake_case", tag = "scope")]
pub enum PropertyOwner {
    /// User-scoped property only
    User { user_id: String },
    /// Organization-scoped property only
    Organization { organization_id: i32 },
    /// Both user and organization-scoped
    UserAndOrganization {
        user_id: String,
        organization_id: i32,
    },
    /// System-owned property (no user or org owner)
    System,
}

impl PropertyOwner {
    /// Get the organization_id if present
    pub fn organization_id(&self) -> Option<i32> {
        match self {
            PropertyOwner::Organization { organization_id } => Some(*organization_id),
            PropertyOwner::UserAndOrganization {
                organization_id, ..
            } => Some(*organization_id),
            PropertyOwner::User { .. } | PropertyOwner::System => None,
        }
    }

    /// Get the user_id if present
    pub fn user_id(&self) -> Option<&str> {
        match self {
            PropertyOwner::User { user_id } => Some(user_id.as_str()),
            PropertyOwner::UserAndOrganization { user_id, .. } => Some(user_id.as_str()),
            PropertyOwner::Organization { .. } | PropertyOwner::System => None,
        }
    }

    /// Create from optional org_id, user_id, and is_system flag (for DB conversions)
    pub fn from_optional_ids(
        organization_id: Option<i32>,
        user_id: Option<String>,
        is_system: bool,
    ) -> Self {
        if is_system {
            return PropertyOwner::System;
        }
        match (organization_id, user_id) {
            (Some(org_id), Some(uid)) => PropertyOwner::UserAndOrganization {
                user_id: uid,
                organization_id: org_id,
            },
            (Some(org_id), None) => PropertyOwner::Organization {
                organization_id: org_id,
            },
            (None, Some(uid)) => PropertyOwner::User { user_id: uid },
            (None, None) => {
                // This should not happen for non-system properties
                // but we handle it gracefully by returning System
                PropertyOwner::System
            }
        }
    }
}
