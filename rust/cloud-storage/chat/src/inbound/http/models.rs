//! HTTP endpoint exposing the per-user model access list.

use std::sync::Arc;

use axum::{Json, Router, extract::State, routing::get};

use crate::domain::models::ModelsResponse;
use crate::domain::ports::ModelAccessService;
use crate::inbound::http::extractors::ChatModelAccess;

/// Build the `GET /models` router backed by `service`.
pub fn models_router<M: ModelAccessService, T: Send + Sync + 'static>(service: M) -> Router<T> {
    Router::new()
        .route("/models", get(list_models_handler::<M>))
        .with_state(Arc::new(service))
}

#[utoipa::path(
    get,
    path = "/chats/models",
    tag = "chats",
    operation_id = "list_models",
    responses(
        (status = 200, body = ModelsResponse),
        (status = 500, body = String),
    )
)]
/// List all chat models, each flagged with whether the requesting user has
/// access (free users get Haiku; professional users get everything).
#[tracing::instrument(skip(service, access))]
pub async fn list_models_handler<M: ModelAccessService>(
    State(service): State<Arc<M>>,
    access: ChatModelAccess,
) -> Json<ModelsResponse> {
    Json(service.list_models(access.professional()))
}
