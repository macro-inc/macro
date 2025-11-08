use axum::{
    Extension, Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::{
    response::{EmptyResponse, ErrorResponse},
    user::UserContext,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::ToSchema;

#[derive(Serialize, Deserialize, Debug, ToSchema)]
pub struct UpdateUserExperimentRequest {
    /// The id of the experiment
    pub experiment_id: String,
}

/// Updates an experiment for the user
#[utoipa::path(
        patch,
        operation_id = "update_user_experiment",
        path = "/user",
        responses(
            (status = 200, body = EmptyResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(db, req, user_context), fields(user_id=?user_context.user_id))]
pub async fn handler(
    State(db): State<PgPool>,
    user_context: Extension<UserContext>,
    extract::Json(req): extract::Json<UpdateUserExperimentRequest>,
) -> Result<Response, Response> {
    macro_db_client::experiment_log::complete_experiment_log(
        &db,
        &user_context.user_id,
        &req.experiment_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "failed to update experiment log");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "failed to update experiment log",
            }),
        )
            .into_response()
    })?;

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
