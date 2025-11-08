use axum::{
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::response::{EmptyResponse, ErrorResponse};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::ToSchema;

#[derive(Serialize, Deserialize, Debug, ToSchema)]
pub struct InitializeUserExperimentsRequest {
    pub user_id: String,
}

/// Initializes the experiments for a provided user
#[utoipa::path(
        post,
        operation_id = "initialize_user_experiments",
        path = "/experiment/initialize",
        responses(
            (status = 200, body = EmptyResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(db))]
pub async fn handler(
    State(db): State<PgPool>,
    extract::Json(req): extract::Json<InitializeUserExperimentsRequest>,
) -> Result<Response, Response> {
    let active_experiments = macro_db_client::experiment::get_active_experiments(&db)
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

    let active_experiments = active_experiments
        .into_iter()
        .map(|e| {
            let mut rng = rand::rng();
            let random_bool = rng.random_bool(0.5);
            if random_bool {
                (e.id, "A".to_string())
            } else {
                (e.id, "B".to_string())
            }
        })
        .collect::<Vec<(String, String)>>();

    if let Err(e) = macro_db_client::experiment_log::bulk_create_experiment_logs(
        &db,
        &req.user_id,
        &active_experiments,
    )
    .await
    {
        tracing::error!(error=?e, "failed to bulk create experiment logs");
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "failed to bulk create experiment logs",
            }),
        )
            .into_response());
    }

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
