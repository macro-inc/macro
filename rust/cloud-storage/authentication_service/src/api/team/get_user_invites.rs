use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::api::{context::ApiContext, team::get_team_invites::TeamInvitesResponse};

use model::{response::ErrorResponse, tracking::IPContext, user::UserContext};

/// Gets all of a user's invitations.
#[utoipa::path(
        get,
        path = "/team/user/invites",
        operation_id = "get_user_invites",
        responses(
            (status = 200, body=TeamInvitesResponse),
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
    tracing::info!("get_user_invites");

    let team_invites =
        macro_db_client::team::get::get_user_team_invites(&ctx.db, &user_context.user_id)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "failed to get user invites");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to get user invites",
                    }),
                )
                    .into_response()
            })?;

    let response = TeamInvitesResponse {
        invites: team_invites,
    };

    Ok((StatusCode::OK, Json(response)).into_response())
}
