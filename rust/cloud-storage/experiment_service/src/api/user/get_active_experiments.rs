use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::{experiment::Experiment, response::ErrorResponse, user::UserContext};
use sqlx::PgPool;

/// Sets an experiment for the user
#[utoipa::path(
        get,
        operation_id = "get_user_experiments",
        path = "/user",
        responses(
            (status = 200, body = Vec<Experiment>),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(db, user_context), fields(user_id=?user_context.user_id))]
pub async fn handler(
    State(db): State<PgPool>,
    user_context: Extension<UserContext>,
) -> Result<Response, Response> {
    let experiments =
        macro_db_client::experiment::get_active_experiments_for_user(&db, &user_context.user_id)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "failed to get active experiments");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "failed to get active experiments",
                    }),
                )
                    .into_response()
            })?;

    Ok((StatusCode::OK, Json(experiments)).into_response())
}
