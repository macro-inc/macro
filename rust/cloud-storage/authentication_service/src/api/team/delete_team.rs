use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use teams::domain::{model::DeleteTeamError, team_repo::TeamService};

use crate::api::{
    context::ApiContext,
    middleware::team_access::{OwnerRole, TeamAccessRoleExtractor},
    team::TeamPathParam,
};

use model::{
    response::{EmptyResponse, ErrorResponse},
    tracking::IPContext,
    user::UserContext,
};

#[derive(Debug, thiserror::Error)]
pub enum DeleteTeamHandlerError {
    #[error("Delete team error")]
    DeleteTeamError(#[from] DeleteTeamError),
}

impl IntoResponse for DeleteTeamHandlerError {
    fn into_response(self) -> Response {
        match self {
            DeleteTeamHandlerError::DeleteTeamError(e) => match e {
                DeleteTeamError::TeamError(_) | DeleteTeamError::StorageLayerError(_) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to delete team",
                    }),
                ),
                DeleteTeamError::RemoveRolesFromUserError(_) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "invalid roles provided",
                    }),
                ),
                DeleteTeamError::CustomerError(_) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to delete team subscription",
                    }),
                ),
            },
        }
        .into_response()
    }
}

/// Deletes a team.
/// This will update all team members roles and cancel your subscription for the team.
/// This action is **irreversible** and you will not be able to recover the team afterwards.
#[utoipa::path(
        delete,
        path = "/team/{team_id}",
        operation_id = "delete_team",
        params(
            ("team_id" = String, Path, description = "The ID of the team to delete")
        ),
        responses(
            (status = 200, body=EmptyResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        ),
    )]
#[tracing::instrument(skip(ctx, ip_context, user_context), err, fields(client_ip=%ip_context.client_ip, user_id=%user_context.user_id, fusion_user_id=%user_context.fusion_user_id))]
pub async fn handler(
    access: TeamAccessRoleExtractor<OwnerRole>,
    State(ctx): State<ApiContext>,
    ip_context: Extension<IPContext>,
    user_context: Extension<UserContext>,
    Path(TeamPathParam { team_id }): Path<TeamPathParam>,
) -> Result<Json<EmptyResponse>, DeleteTeamHandlerError> {
    tracing::info!("delete_team");

    ctx.teams_service.delete_team(&team_id).await?;

    Ok(Json(EmptyResponse::default()))
}
