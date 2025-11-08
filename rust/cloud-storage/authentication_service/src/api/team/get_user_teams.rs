use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use models_team::Team;

use crate::api::context::ApiContext;

use model::{response::ErrorResponse, tracking::IPContext, user::UserContext};

/// Gets all teams for the authenticated user.
#[utoipa::path(
        get,
        path = "/team/user",
        operation_id = "get_user_teams",
        responses(
            (status = 200, body=Vec<Team>),
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
) -> Result<Response, Response> {
    tracing::info!("get_user_teams");

    let teams = macro_db_client::team::get::get_user_teams(&ctx.db, &user_context.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get user teams");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to get user teams",
                }),
            )
                .into_response()
        })?;

    Ok((StatusCode::OK, Json(teams)).into_response())
}
