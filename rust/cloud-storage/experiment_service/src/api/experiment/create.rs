use axum::{
    Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::{experiment::Experiment, response::ErrorResponse};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::ToSchema;

#[derive(Serialize, Deserialize, Debug, ToSchema)]
pub struct CreateExperimentRequest {
    pub id: String,
}

/// Creates a new experiment
#[utoipa::path(
        post,
        operation_id = "create_experiment",
        path = "/experiment",
        responses(
            (status = 200, body = Experiment),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(db, req))]
pub async fn handler(
    State(db): State<PgPool>,
    extract::Json(req): extract::Json<CreateExperimentRequest>,
) -> Result<Response, Response> {
    let experiment = macro_db_client::experiment::create_experiment(&db, &req.id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to create experiment");
            (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to create experiment. an experiment with that name may already exist",
                    }),
            ).into_response()
        })?;

    Ok((StatusCode::OK, Json(experiment)).into_response())
}
