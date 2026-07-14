use crate::domain::MemoryService;
use axum::{
    Json, Router,
    extract::{FromRef, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use macro_authorization::{SharedMacroAuthorizationExtractor, SharedMacroAuthorizationService};
use serde::Serialize;
use std::sync::Arc;
use utoipa::ToSchema;

/// The user's latest memory.
#[derive(Serialize, ToSchema)]
pub struct MemoryResponse {
    /// The generated memory text.
    pub memory: String,
}

#[derive(Serialize, ToSchema)]
pub struct MemoryErrorBody {
    /// Error description.
    pub error: String,
}

/// State for the memory router.
pub struct MemoryRouterState<T> {
    /// The memory service implementation.
    pub service: Arc<T>,
    /// The authorization service used to authenticate callers.
    pub authorization: SharedMacroAuthorizationService,
}

impl<T> Clone for MemoryRouterState<T> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization: self.authorization.clone(),
        }
    }
}

impl<T> FromRef<MemoryRouterState<T>> for Arc<T> {
    fn from_ref(state: &MemoryRouterState<T>) -> Self {
        state.service.clone()
    }
}

impl<T> FromRef<MemoryRouterState<T>> for SharedMacroAuthorizationService {
    fn from_ref(state: &MemoryRouterState<T>) -> Self {
        state.authorization.clone()
    }
}

pub fn memory_router<T, S>(state: MemoryRouterState<T>) -> Router<S>
where
    T: MemoryService + Send + Sync + 'static,
    S: Send + Sync + Clone + 'static,
{
    Router::new()
        .route("/memory", get(get_memory_handler::<T>))
        .with_state(state)
}

/// Get the authenticated user's latest memory.
///
/// Returns the current memory if one exists. If the memory is stale or missing,
/// a background generation is triggered and the endpoint returns the stale
/// memory (200) or 404 if none exists yet.
#[utoipa::path(
    get,
    path = "/memory",
    responses(
        (status = 200, description = "Latest memory for the user", body = MemoryResponse),
        (status = 404, description = "No memory exists for this user yet (generation triggered)"),
        (status = 500, description = "Internal server error", body = MemoryErrorBody),
    ),
    tag = "memory"
)]
#[tracing::instrument(skip(service, user), fields(user_id = %user.macro_user_id))]
pub async fn get_memory_handler<T: MemoryService>(
    State(service): State<Arc<T>>,
    user: SharedMacroAuthorizationExtractor,
) -> Response {
    match service.get_or_generate_memory(user.macro_user_id).await {
        Ok(Some(memory)) => Json(MemoryResponse { memory }).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!(error = ?e, "failed to get memory");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(MemoryErrorBody {
                    error: "failed to get memory".to_string(),
                }),
            )
                .into_response()
        }
    }
}
