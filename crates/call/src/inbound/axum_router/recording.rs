//! Thin HTTP adapters for recording defaults and team recording blocks.

use super::*;
use crate::domain::recording::{
    CallRecordingSettings, UpdateRecordingDefaultsRequest, UpdateTeamRecordingPolicyRequest,
};
use entity_access::{
    domain::models::AdminTeamRole, inbound::axum_extractors::MacroUserTeamExtractorV2,
};

/// Read the caller's recording defaults and their team's recording blocks.
#[utoipa::path(get, operation_id = "get_call_recording_settings", path = "/call/settings/recording",
    responses((status = 200, body = CallRecordingSettings), (status = 401, body = ErrorResponse), (status = 500, body = ErrorResponse))) ]
#[tracing::instrument(err, skip_all)]
pub async fn get<S: CallService, Svc: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<CallRouterState<S, Svc, Auth>>,
    actor: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<CallRecordingSettings>, CallError> {
    Ok(Json(
        state
            .service
            .get_recording_settings(actor.authorization.user.macro_user_id.clone())
            .await?,
    ))
}

/// Change which kinds of the caller's own calls record by default.
#[utoipa::path(patch, operation_id = "update_call_recording_defaults", path = "/call/settings/recording",
    request_body = UpdateRecordingDefaultsRequest,
    responses((status = 200, body = CallRecordingSettings), (status = 400, body = ErrorResponse), (status = 401, body = ErrorResponse), (status = 500, body = ErrorResponse))) ]
#[tracing::instrument(err, skip_all)]
pub async fn update_defaults<
    S: CallService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<CallRouterState<S, Svc, Auth>>,
    actor: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(request): Json<UpdateRecordingDefaultsRequest>,
) -> Result<Json<CallRecordingSettings>, CallError> {
    Ok(Json(
        state
            .service
            .update_recording_defaults(actor.authorization.user.macro_user_id.clone(), request)
            .await?,
    ))
}

/// Change which kinds of call no one on the caller's team may record. Team
/// admins and owners only.
#[utoipa::path(patch, operation_id = "update_team_call_recording_policy", path = "/call/settings/recording/team",
    request_body = UpdateTeamRecordingPolicyRequest,
    responses((status = 200, body = CallRecordingSettings), (status = 400, body = ErrorResponse), (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse), (status = 500, body = ErrorResponse))) ]
#[tracing::instrument(err, skip_all)]
pub async fn update_team<
    S: CallService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<CallRouterState<S, Svc, Auth>>,
    access: MacroUserTeamExtractorV2<AdminTeamRole, Svc, Auth>,
    Json(request): Json<UpdateTeamRecordingPolicyRequest>,
) -> Result<Json<CallRecordingSettings>, CallError> {
    Ok(Json(
        state
            .service
            .update_team_recording_policy(access.entity_access_receipt, request)
            .await?,
    ))
}
