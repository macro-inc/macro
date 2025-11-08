use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use models_team::TeamInvite;

use crate::api::{
    context::ApiContext,
    middleware::team_access::{AdminRole, TeamAccessRoleExtractor},
    team::TeamPathParam,
};

use model::{response::ErrorResponse, tracking::IPContext, user::UserContext};

#[derive(serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct TeamInvitesResponse {
    pub invites: Vec<TeamInvite>,
}

/// Gets all invites for a team.
#[utoipa::path(
        get,
        path = "/team/{team_id}/invites",
        operation_id = "get_team_invites",
        params(
            ("team_id" = String, Path, description = "The ID of the team to get invites for")
        ),
        responses(
            (status = 200, body=TeamInvitesResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        ),
    )]
#[tracing::instrument(skip(ctx, ip_context, user_context), fields(client_ip=%ip_context.client_ip, user_id=%user_context.user_id, fusion_user_id=%user_context.fusion_user_id))]
pub async fn handler(
    access: TeamAccessRoleExtractor<AdminRole>,
    State(ctx): State<ApiContext>,
    ip_context: Extension<IPContext>,
    user_context: Extension<UserContext>,
    Path(TeamPathParam { team_id }): Path<TeamPathParam>,
) -> Result<Response, Response> {
    tracing::info!("get_team_invites");

    let invites = macro_db_client::team::get::get_team_invites(&ctx.db, &team_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get team invites");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to get team invites",
                }),
            )
                .into_response()
        })?;

    let response = TeamInvitesResponse { invites };

    Ok((StatusCode::OK, Json(response)).into_response())
}
