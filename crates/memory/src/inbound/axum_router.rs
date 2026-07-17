use crate::domain::MemoryService;
use axum::{
    Json, Router,
    extract::{FromRef, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
};
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

/// Router state containing the memory service and the authorization state
/// used to authenticate callers.
pub struct MemoryRouterState<T, Auth> {
    /// The memory service implementation.
    pub service: Arc<T>,
    /// The authorization state used by the request extractors.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

// Manual Clone impl so T doesn't need to be Clone (it's behind Arc).
impl<T, Auth> Clone for MemoryRouterState<T, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<T, Auth> FromRef<MemoryRouterState<T, Auth>> for Arc<T> {
    fn from_ref(state: &MemoryRouterState<T, Auth>) -> Self {
        state.service.clone()
    }
}

impl<T, Auth> FromRef<MemoryRouterState<T, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &MemoryRouterState<T, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

pub fn memory_router<T, Auth, S>(state: MemoryRouterState<T, Auth>) -> Router<S>
where
    T: MemoryService + Send + Sync + 'static,
    Auth: MacroAuthorizationService,
    S: Send + Sync + Clone + 'static,
{
    Router::new()
        .route("/memory", get(get_memory_handler::<T, Auth>))
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
pub async fn get_memory_handler<T: MemoryService, Auth: MacroAuthorizationService>(
    State(service): State<Arc<T>>,
    user: MacroAuthorizationExtractor<Auth>,
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
