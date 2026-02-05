use crate::share_permission::access_level::AccessLevel;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Local copy of `model::comms::ParticipantRole` to avoid a cyclic dependency.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ParticipantRole {
    Owner,
    Admin,
    Member,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum EntityPermissionResponse {
    Access { permission: EntityPermission },
    NoAccess,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EntityPermission {
    AccessLevel { access_level: AccessLevel },
    ChannelRole { role: ParticipantRole },
}