//! Thin transport adapters for agent-session sharing use cases.

use super::{AgentSessionApiError, AgentSessionRouterState};
use crate::domain::sharing::SessionSharing;
use axum::{Json, Router, extract::State, routing::get};
use entity_access::{
    domain::{
        models::{OwnerAccessLevel, ViewAccessLevel},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::AgentSessionAccessLevelExtractor,
};
use macro_authorization::MacroAuthorizationService;
use models_permissions::share_permission::{SharePermissionV2, UpdateSharePermissionRequestV2};

/// Sharing routes, mounted below `/agent-sessions`.
pub fn agent_session_sharing_router<T, Access, Auth, S>(
    state: AgentSessionRouterState<T, Access, Auth>,
) -> Router<S>
where
    T: SessionSharing,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/{session_id}/permissions",
            get(get_agent_session_permissions::<T, Access, Auth>)
                .patch(update_agent_session_permissions::<T, Access, Auth>),
        )
        .with_state(state)
}

#[utoipa::path(
    get,
    path = "/agent-sessions/{session_id}/permissions",
    tag = "agent-sessions",
    operation_id = "get_agent_session_permissions",
    params(("session_id" = macro_uuid::Uuid, Path, description = "ID of the agent session")),
    responses((status = 200, body = SharePermissionV2), (status = 403, body = String), (status = 500, body = String))
)]
/// Read sharing settings for a session the caller can view.
#[tracing::instrument(skip_all, err(Debug))]
pub async fn get_agent_session_permissions<
    T: SessionSharing,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: AgentSessionAccessLevelExtractor<ViewAccessLevel, Access, Auth>,
    State(state): State<AgentSessionRouterState<T, Access, Auth>>,
) -> Result<Json<SharePermissionV2>, AgentSessionApiError> {
    Ok(Json(
        state
            .service
            .permissions(&access.entity_access_receipt)
            .await?,
    ))
}

#[utoipa::path(
    patch,
    path = "/agent-sessions/{session_id}/permissions",
    tag = "agent-sessions",
    operation_id = "update_agent_session_permissions",
    params(("session_id" = macro_uuid::Uuid, Path, description = "ID of the agent session")),
    request_body = UpdateSharePermissionRequestV2,
    responses((status = 200, body = SharePermissionV2), (status = 400, body = String), (status = 403, body = String), (status = 409, body = String), (status = 500, body = String))
)]
/// Update link, channel, or team sharing after owner authorization.
#[tracing::instrument(skip_all, err(Debug))]
pub async fn update_agent_session_permissions<
    T: SessionSharing,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: AgentSessionAccessLevelExtractor<OwnerAccessLevel, Access, Auth>,
    State(state): State<AgentSessionRouterState<T, Access, Auth>>,
    Json(request): Json<UpdateSharePermissionRequestV2>,
) -> Result<Json<SharePermissionV2>, AgentSessionApiError> {
    Ok(Json(
        state
            .service
            .update_permissions(&access.entity_access_receipt, request)
            .await?,
    ))
}
