use axum::{
    Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::{
    experiment::ExperimentOperation,
    response::{EmptyResponse, ErrorResponse},
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::ToSchema;

#[derive(Serialize, Deserialize, Debug, ToSchema)]
pub struct PatchExperimentRequest {
    pub experiment_id: String,
    pub operation: ExperimentOperation,
}

/// Updates an experiment
#[utoipa::path(
        patch,
        operation_id = "patch_experiment",
        path = "/experiment",
        responses(
            (status = 200, body =EmptyResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(db, req))]
pub async fn handler(
    State(db): State<PgPool>,
    extract::Json(req): extract::Json<PatchExperimentRequest>,
) -> Result<Response, Response> {
    macro_db_client::experiment::patch_experiment(&db, &req.experiment_id, req.operation)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to patch experiment");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to patch experiment",
                }),
            )
                .into_response()
        })?;

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
