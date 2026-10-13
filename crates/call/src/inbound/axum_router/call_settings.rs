//! Thin HTTP adapters for call settings and team call policies.

use super::*;
use crate::domain::recording::{
    CallSettings, UpdateCallSettingsRequest, UpdateTeamCallPolicyRequest,
};
use entity_access::{
    domain::models::AdminTeamRole, inbound::axum_extractors::MacroUserTeamExtractorV2,
};

/// Read the caller's call settings and their team's call policy.
#[utoipa::path(get, operation_id = "get_call_settings", path = "/call/settings",
    responses((status = 200, body = CallSettings), (status = 401, body = ErrorResponse), (status = 500, body = ErrorResponse))) ]
#[tracing::instrument(err, skip_all)]
pub async fn get<S: CallService, Svc: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<CallRouterState<S, Svc, Auth>>,
    actor: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<CallSettings>, CallError> {
    Ok(Json(
        state
            .service
            .get_call_settings(actor.authorization.user.macro_user_id.clone())
            .await?,
    ))
}

/// Change the caller's own call settings.
#[utoipa::path(patch, operation_id = "update_call_settings", path = "/call/settings",
    request_body = UpdateCallSettingsRequest,
    responses((status = 200, body = CallSettings), (status = 400, body = ErrorResponse), (status = 401, body = ErrorResponse), (status = 500, body = ErrorResponse))) ]
#[tracing::instrument(err, skip_all)]
pub async fn update<S: CallService, Svc: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<CallRouterState<S, Svc, Auth>>,
    actor: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(request): Json<UpdateCallSettingsRequest>,
) -> Result<Json<CallSettings>, CallError> {
    Ok(Json(
        state
            .service
            .update_call_settings(actor.authorization.user.macro_user_id.clone(), request)
            .await?,
    ))
}

/// Change what no one on the caller's team may record or share. Team admins
/// and owners only.
#[utoipa::path(patch, operation_id = "update_team_call_policy", path = "/call/settings/team",
    request_body = UpdateTeamCallPolicyRequest,
    responses((status = 200, body = CallSettings), (status = 400, body = ErrorResponse), (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse), (status = 500, body = ErrorResponse))) ]
#[tracing::instrument(err, skip_all)]
pub async fn update_team<
    S: CallService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<CallRouterState<S, Svc, Auth>>,
    access: MacroUserTeamExtractorV2<AdminTeamRole, Svc, Auth>,
    Json(request): Json<UpdateTeamCallPolicyRequest>,
) -> Result<Json<CallSettings>, CallError> {
    Ok(Json(
        state
            .service
            .update_team_call_policy(access.entity_access_receipt, request)
            .await?,
    ))
}
