use crate::core::model::CHAT_MODELS;
use crate::model::response::models::{AIModel, GetModelsResponse};
use ai::types::ModelWithMetadataAndProvider;

use axum::{Json, http::StatusCode, response::IntoResponse};

/// Gets all available models
#[utoipa::path(
        get,
        path = "/models",
        responses(
            (status = 200, body=GetModelsResponse),
        )
    )]
#[tracing::instrument()]
pub async fn get_models_handler() -> impl IntoResponse {
    let models = CHAT_MODELS
        .iter()
        .map(|m| AIModel {
            name: m.to_string(),
            provider: m.provider(),
            metadata: m.metadata(),
        })
        .collect::<Vec<AIModel>>();
    let data = GetModelsResponse { models };
    (StatusCode::OK, Json(data))
}
