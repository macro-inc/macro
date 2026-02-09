use crate::api::context::DssEntityAccessService;
use axum::{Json, http::StatusCode, response::IntoResponse};
use entity_access::{
    domain::models::{EntityPermission, ParticipantRole},
    inbound::axum_extractors::{EntityPermissionExtractor, ExtractorError},
};
use models_permissions::share_permission::access_level::AccessLevel;
use serde::Serialize;
use utoipa::ToSchema;

/// API-facing participant role with OpenAPI schema.
#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ParticipantRoleSchema {
    Owner,
    Admin,
    Member,
}

impl From<ParticipantRole> for ParticipantRoleSchema {
    fn from(role: ParticipantRole) -> Self {
        match role {
            ParticipantRole::Owner => Self::Owner,
            ParticipantRole::Admin => Self::Admin,
            ParticipantRole::Member => Self::Member,
        }
    }
}

/// API-facing entity permission with OpenAPI schema.
#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EntityPermissionSchema {
    AccessLevel { access_level: AccessLevel },
    ChannelRole { role: ParticipantRoleSchema },
}

impl From<EntityPermission> for EntityPermissionSchema {
    fn from(perm: EntityPermission) -> Self {
        match perm {
            EntityPermission::AccessLevel { access_level } => Self::AccessLevel { access_level },
            EntityPermission::ChannelRole { role } => Self::ChannelRole { role: role.into() },
        }
    }
}

/// API response envelope for entity permissions.
#[derive(Debug, Serialize, ToSchema)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum EntityPermissionResponse {
    Access { permission: EntityPermissionSchema },
    NoAccess,
}

/// Get the current user's permission for a given entity.
#[utoipa::path(
    get,
    path = "/entity/{entity_type}/{entity_id}/permissions",
    params(
        ("entity_type" = String, Path, description = "Entity type (document, chat, project, thread, email_thread, channel)"),
        ("entity_id" = String, Path, description = "Entity ID"),
    ),
    responses(
        (status = 200, body = EntityPermissionResponse),
        (status = 400, description = "Bad request"),
        (status = 401, description = "Unauthorized"),
    )
)]
pub async fn handler(
    result: Result<EntityPermissionExtractor<DssEntityAccessService>, ExtractorError>,
) -> impl IntoResponse {
    match result {
        Ok(ext) => {
            let permission = EntityPermissionSchema::from(ext.permission);
            (
                StatusCode::OK,
                Json(EntityPermissionResponse::Access { permission }),
            )
                .into_response()
        }
        Err(ExtractorError::Unauthorized | ExtractorError::UnauthorizedWithMessage(_)) => {
            (StatusCode::OK, Json(EntityPermissionResponse::NoAccess)).into_response()
        }
        Err(e) => e.into_response(),
    }
}
