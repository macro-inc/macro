use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_user_id::user_id::MacroUserId;
use teams::domain::{model::RemoveTeamInviteError, team_repo::TeamService};

use crate::api::context::ApiContext;

use model::{
    response::{EmptyResponse, ErrorResponse},
    tracking::IPContext,
    user::UserContext,
};

#[derive(serde::Deserialize)]
pub struct TeamInvitePathParam {
    pub team_invite_id: uuid::Uuid,
}

#[derive(Debug, thiserror::Error)]
pub enum RejectInvitationError {
    #[error("unable to reject invitation")]
    RemoveTeamInviteError(#[from] RemoveTeamInviteError),
    #[error("unable to parse user id")]
    InvalidMacroUserId,
}

impl IntoResponse for RejectInvitationError {
    fn into_response(self) -> Response {
        match self {
            RejectInvitationError::RemoveTeamInviteError(e) => match e {
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
                        message: "unable to reject invitation",
                    }),
                ),
            },
            RejectInvitationError::InvalidMacroUserId => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "invalid user id",
                }),
            ),
        }
        .into_response()
    }
}

/// Rejects an invitation to join a team.
#[utoipa::path(
        delete,
        path = "/team/join/{team_invite_id}",
        operation_id = "reject_invitation",
        params(
            ("team_invite_id" = String, Path, description = "The team invite id")
        ),
        responses(
            (status = 200, body=EmptyResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        ),
    )]
#[tracing::instrument(skip(ctx, ip_context, user_context), fields(client_ip=%ip_context.client_ip, user_id=%user_context.user_id, fusion_user_id=%user_context.fusion_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    ip_context: Extension<IPContext>,
    user_context: Extension<UserContext>,
    Path(TeamInvitePathParam { team_invite_id }): Path<TeamInvitePathParam>,
) -> Result<(StatusCode, Json<EmptyResponse>), RejectInvitationError> {
    tracing::info!("reject_invitation");

    let macro_user_id = MacroUserId::parse_from_str(&user_context.user_id)
        .map_err(|_| RejectInvitationError::InvalidMacroUserId)?
        .lowercase();

    ctx.teams_service
        .reject_invitation(&macro_user_id, &team_invite_id)
        .await?;

    Ok((StatusCode::OK, Json(EmptyResponse::default())))
}
