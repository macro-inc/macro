use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_user_id::user_id::MacroUserId;
use teams::domain::{model::RemoveUserFromTeamError, team_repo::TeamService};

use crate::api::{
    context::ApiContext,
    middleware::team_access::{OwnerRole, TeamAccessRoleExtractor},
};

use model::{
    response::{EmptyResponse, ErrorResponse},
    tracking::IPContext,
    user::UserContext,
};

#[derive(serde::Deserialize)]
pub struct Param {
    pub team_id: uuid::Uuid,
    pub remove_user_id: String,
}

#[derive(Debug, thiserror::Error)]
pub enum RemoveFromTeamError {
    #[error("unable to remove user from team")]
    RemoveUserFromTeamError(#[from] RemoveUserFromTeamError),
    #[error("unable to parse user id")]
    InvalidMacroUserId,
}

impl IntoResponse for RemoveFromTeamError {
    fn into_response(self) -> Response {
        match self {
            RemoveFromTeamError::RemoveUserFromTeamError(e) => match e {
                RemoveUserFromTeamError::TeamDoesNotExist => (
                    StatusCode::NOT_FOUND,
                    Json(ErrorResponse {
                        message: "team does not exist",
                    }),
                ),
                RemoveUserFromTeamError::RemoveRolesFromUserError(_) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to remove roles from user",
                    }),
                ),
                RemoveUserFromTeamError::NoSubscription => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "no subscription",
                    }),
                ),
                RemoveUserFromTeamError::CannotRemoveOwner => (
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse {
                        message: "cannot remove owner",
                    }),
                ),
                RemoveUserFromTeamError::UserNotInTeam => (
                    StatusCode::NOT_FOUND,
                    Json(ErrorResponse {
                        message: "user not in team",
                    }),
                ),
                RemoveUserFromTeamError::StorageLayerError(_)
                | RemoveUserFromTeamError::CustomerError(_)
                | RemoveUserFromTeamError::TeamError(_) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to remove user from team",
                    }),
                ),
            },
            RemoveFromTeamError::InvalidMacroUserId => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "invalid user id",
                }),
            ),
        }
        .into_response()
    }
}

/// Removes a user from a team.
#[utoipa::path(
        delete,
        path = "/team/{team_id}/remove/{remove_user_id}",
        operation_id = "remove_user_from_team",
        params(
            ("team_id" = String, Path, description = "The ID of the team to invite to"),
            ("remove_user_id" = String, Path, description = "The ID of the user to remove")
        ),
        responses(
            (status = 200, body=EmptyResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 429, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        ),
    )]
#[tracing::instrument(skip(ctx, ip_context, user_context), fields(client_ip=%ip_context.client_ip, user_id=%user_context.user_id, fusion_user_id=%user_context.fusion_user_id))]
pub async fn handler(
    access: TeamAccessRoleExtractor<OwnerRole>,
    State(ctx): State<ApiContext>,
    ip_context: Extension<IPContext>,
    user_context: Extension<UserContext>,
    Path(Param {
        team_id,
        remove_user_id,
    }): Path<Param>,
) -> Result<(StatusCode, Json<EmptyResponse>), RemoveFromTeamError> {
    tracing::info!("remove_user_from_team");

    let remove_user_id = MacroUserId::parse_from_str(&remove_user_id)
        .map_err(|_| RemoveFromTeamError::InvalidMacroUserId)?
        .lowercase();

    ctx.teams_service
        .remove_user_from_team(&team_id, &remove_user_id)
        .await?;

    Ok((StatusCode::OK, Json(EmptyResponse::default())))
}
