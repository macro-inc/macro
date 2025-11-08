//! Shared property ownership type.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Defines who owns a property - user-scoped, org-scoped, or both.
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
}

impl PropertyOwner {
    /// Get the organization_id if present
    pub fn organization_id(&self) -> Option<i32> {
        match self {
            PropertyOwner::Organization { organization_id } => Some(*organization_id),
            PropertyOwner::UserAndOrganization {
                organization_id, ..
            } => Some(*organization_id),
            PropertyOwner::User { .. } => None,
        }
    }

    /// Get the user_id if present
    pub fn user_id(&self) -> Option<&str> {
        match self {
            PropertyOwner::User { user_id } => Some(user_id.as_str()),
            PropertyOwner::UserAndOrganization { user_id, .. } => Some(user_id.as_str()),
            PropertyOwner::Organization { .. } => None,
        }
    }

    /// Create from optional org_id and user_id (for DB conversions)
    pub fn from_optional_ids(
        organization_id: Option<i32>,
        user_id: Option<String>,
    ) -> Option<Self> {
        match (organization_id, user_id) {
            (Some(org_id), Some(uid)) => Some(PropertyOwner::UserAndOrganization {
                user_id: uid,
                organization_id: org_id,
            }),
            (Some(org_id), None) => Some(PropertyOwner::Organization {
                organization_id: org_id,
            }),
            (None, Some(uid)) => Some(PropertyOwner::User { user_id: uid }),
            (None, None) => None,
        }
    }
}
