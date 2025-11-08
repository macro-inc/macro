use axum::{
    Extension, Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::ToSchema;

use model::{
    response::{EmptyResponse, ErrorResponse},
    user::UserContext,
};

#[derive(Serialize, Deserialize, Debug, ToSchema)]
pub struct SetUserExperimentRequest {
    /// The id of the experiment
    pub experiment_id: String,
    /// The group the experiment belongs to, can either be 'A' or 'B'
    pub group: String,
}

/// Sets an experiment for the user
#[utoipa::path(
        post,
        operation_id = "set_user_experiment",
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
    extract::Json(req): extract::Json<SetUserExperimentRequest>,
) -> Result<Response, Response> {
    macro_db_client::experiment_log::create_experiment_log(
        &db,
        &user_context.user_id,
        &req.experiment_id,
        &req.group,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "failed to create experiment log");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "failed to create experiment log",
            }),
        )
            .into_response()
    })?;

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
