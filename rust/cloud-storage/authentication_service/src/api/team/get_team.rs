use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use models_team::TeamWithUsers;

use crate::api::{
    context::ApiContext,
    middleware::team_access::{MemberRole, TeamAccessRoleExtractor},
    team::TeamPathParam,
};

use model::{response::ErrorResponse, tracking::IPContext, user::UserContext};

/// Gets a team by ID.
#[utoipa::path(
        get,
        path = "/team/{team_id}",
        operation_id = "get_team",
        params(
            ("team_id" = String, Path, description = "The ID of the team to retrieve")
        ),
        responses(
            (status = 200, body=TeamWithUsers),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        ),
    )]
#[tracing::instrument(skip(ctx, ip_context, user_context), fields(client_ip=%ip_context.client_ip, user_id=%user_context.user_id, fusion_user_id=%user_context.fusion_user_id))]
pub async fn handler(
    access: TeamAccessRoleExtractor<MemberRole>,

    State(ctx): State<ApiContext>,
    ip_context: Extension<IPContext>,
    user_context: Extension<UserContext>,
    Path(TeamPathParam { team_id }): Path<TeamPathParam>,
) -> Result<Response, Response> {
    tracing::info!("get_team");

    let team = macro_db_client::team::get::get_team_by_id(&ctx.db, &team_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get team");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to get team",
                }),
            )
                .into_response()
        })?;

    Ok((StatusCode::OK, Json(team)).into_response())
}
