use axum::{
    Extension, Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_user_id::user_id::MacroUserIdStr;
use models_team::Team;
use teams::domain::team_repo::TeamService;

use crate::api::context::ApiContext;

use model::{response::ErrorResponse, tracking::IPContext, user::UserContext};

/// The request body to create a new team
#[derive(serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct CreateTeamRequest {
    /// The name of the team
    pub name: String,
}

/// Creates a new team.
#[utoipa::path(
        post,
        path = "/team",
        operation_id = "create_team",
        responses(
            (status = 200, body=Team),
            (status = 400, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        ),
    )]
#[tracing::instrument(skip(ctx, ip_context, user_context, req), fields(client_ip=%ip_context.client_ip, user_id=%user_context.user_id, fusion_user_id=%user_context.fusion_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    ip_context: Extension<IPContext>,
    user_context: Extension<UserContext>,
    extract::Json(req): extract::Json<CreateTeamRequest>,
) -> Result<Response, Response> {
    tracing::info!("create_team");

    let macro_user_id = MacroUserIdStr::parse_from_str(&user_context.user_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "invalid macro user id",
            }),
        )
            .into_response()
    })?;

    let team = ctx
        .teams_service
        .create_team(&macro_user_id, &req.name)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to create team",
                }),
            )
                .into_response()
        })?;

    Ok((StatusCode::OK, Json(team)).into_response())
}
