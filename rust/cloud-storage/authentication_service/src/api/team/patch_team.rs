use axum::{
    Extension, Json,
    extract::{self, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use models_team::PatchTeamRequest;

use crate::api::{
    context::ApiContext,
    middleware::team_access::{AdminRole, TeamAccessRoleExtractor},
    team::TeamPathParam,
};

use model::{
    response::{EmptyResponse, ErrorResponse},
    tracking::IPContext,
    user::UserContext,
};

/// Updates a team.
#[utoipa::path(
        patch,
        path = "/team/{team_id}",
        operation_id = "patch_team",
        params(
            ("team_id" = String, Path, description = "The ID of the team to update")
        ),
        request_body = PatchTeamRequest,
        responses(
            (status = 200, body=EmptyResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        ),
    )]
#[tracing::instrument(skip(ctx, ip_context, user_context, req), fields(client_ip=%ip_context.client_ip, user_id=%user_context.user_id, fusion_user_id=%user_context.fusion_user_id))]
pub async fn handler(
    access: TeamAccessRoleExtractor<AdminRole>,
    State(ctx): State<ApiContext>,
    ip_context: Extension<IPContext>,
    user_context: Extension<UserContext>,
    Path(TeamPathParam { team_id }): Path<TeamPathParam>,
    extract::Json(req): extract::Json<PatchTeamRequest>,
) -> Result<Response, Response> {
    tracing::info!("patch_team");

    macro_db_client::team::patch::patch_team(&ctx.db, &team_id, &req)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to update team");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to update team",
                }),
            )
                .into_response()
        })?;

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
