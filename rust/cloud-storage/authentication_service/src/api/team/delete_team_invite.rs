use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use teams::domain::{model::RemoveTeamInviteError, team_repo::TeamService};

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
    pub team_invite_id: uuid::Uuid,
}

#[derive(Debug, thiserror::Error)]
pub enum DeleteTeamInviteError {
    #[error("unable to delete team invite")]
    RemoveTeamInviteError(#[from] RemoveTeamInviteError),
}

impl IntoResponse for DeleteTeamInviteError {
    fn into_response(self) -> Response {
        match self {
            DeleteTeamInviteError::RemoveTeamInviteError(e) => match e {
                RemoveTeamInviteError::TeamInviteDoesNotExist => (
                    StatusCode::NOT_FOUND,
                    Json(ErrorResponse {
                        message: "team invite does not exist",
                    }),
                ),
                RemoveTeamInviteError::UserNotInTeam => (
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse {
                        message: "user not in team",
                    }),
                ),
                RemoveTeamInviteError::StorageLayerError(_)
                | RemoveTeamInviteError::CustomerError(_)
                | RemoveTeamInviteError::TeamError(_) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to delete team invite",
                    }),
                ),
            },
        }
        .into_response()
    }
}

/// Deletes a team invite from a team.
#[utoipa::path(
        delete,
        path = "/team/{team_id}/remove/{team_invite_id}",
        operation_id = "delete_team_invite_handler",
        params(
            ("team_id" = String, Path, description = "The ID of the team to invite to"),
            ("team_invite_id" = String, Path, description = "The ID of the team invite to reinvite")
        ),
        responses(
            (status = 200, body=EmptyResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
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
        team_invite_id,
    }): Path<Param>,
) -> Result<(StatusCode, Json<EmptyResponse>), DeleteTeamInviteError> {
    tracing::info!("delete_team_invite_handler");

    ctx.teams_service
        .delete_team_invite(&team_id, &team_invite_id)
        .await?;

    Ok((StatusCode::OK, Json(EmptyResponse::default())))
}
