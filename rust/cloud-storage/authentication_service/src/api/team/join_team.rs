use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use teams::domain::{model::JoinTeamError, team_repo::TeamService};

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
pub enum JoinTeamHandlerError {
    #[error("unable to join team")]
    JoinTeamError(#[from] JoinTeamError),
    #[error("unable to parse user id")]
    InvalidMacroUserId,
}

impl IntoResponse for JoinTeamHandlerError {
    fn into_response(self) -> Response {
        match self {
            JoinTeamHandlerError::JoinTeamError(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to join team",
                }),
            )
                .into_response(),
            JoinTeamHandlerError::InvalidMacroUserId => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: &self.to_string(),
                }),
            )
                .into_response(),
        }
    }
}

/// Joins a team by accepting an invite.
#[utoipa::path(
        get,
        path = "/team/join/{team_invite_id}",
        operation_id = "join_team",
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
#[tracing::instrument(skip(ctx, user_context, ip_context), err, fields(user_id=%user_context.user_id, client_ip=%ip_context.client_ip))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    ip_context: Extension<IPContext>,
    user_context: Extension<UserContext>,
    Path(TeamInvitePathParam { team_invite_id }): Path<TeamInvitePathParam>,
) -> Result<Json<EmptyResponse>, JoinTeamHandlerError> {
    tracing::info!("join_team");

    let user_id: MacroUserId<Lowercase> = MacroUserId::parse_from_str(&user_context.user_id)
        .map_err(|_| JoinTeamHandlerError::InvalidMacroUserId)?
        .lowercase();

    ctx.teams_service
        .join_team(&team_invite_id, &user_id)
        .await?;

    Ok(Json(EmptyResponse::default()))
}
