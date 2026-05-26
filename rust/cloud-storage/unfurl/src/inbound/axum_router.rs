//! Axum HTTP adapter for the unfurl service.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Query, State},
    http::StatusCode,
    routing::get,
};
use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};

use crate::domain::{models::GetUnfurlResponse, ports::UnfurlService};

/// Axum state for the unfurl router, holding a shared reference to a
/// [`UnfurlService`] implementation.
pub struct UnfurlRouterState<T> {
    inner: Arc<T>,
}

impl<T> Clone for UnfurlRouterState<T> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl<T> UnfurlRouterState<T>
where
    T: UnfurlService,
{
    /// Wrap the given service in router state.
    pub fn new(service: T) -> Self {
        Self {
            inner: Arc::new(service),
        }
    }
}

/// Build the unfurl router. The single `GET /` route is mounted at the
/// crate's `/unfurl` path by the consuming service.
pub fn unfurl_router<S, T>(state: UnfurlRouterState<T>) -> Router<S>
where
    S: Send + Sync + 'static,
    T: UnfurlService,
{
    Router::new()
        .route("/", get(get_unfurl_handler::<T>))
        .with_state(state)
}

/// Query parameters for `GET /unfurl`.
#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct GetUnfurlQueryParams {
    /// The URL to unfurl.
    pub url: String,
}

/// Unfurl the URL passed via the `url` query parameter and return its
/// extracted metadata (title, description, image, favicon).
///
/// On success returns `200` with a [`GetUnfurlResponse`] body. On any
/// failure returns `500` with a JSON `null` body — the response type is an
/// `Option<GetUnfurlResponse>` so this contract is reflected in the
/// signature and OpenAPI spec.
#[utoipa::path(
    get,
    tag = "unfurl",
    operation_id = "get_unfurl",
    path = "/unfurl",
    responses(
        (status = 200, body = GetUnfurlResponse, description = "Unfurled metadata for the URL."),
        (
            status = 500,
            body = Option<GetUnfurlResponse>,
            description = "Unfurl failed; response body is JSON null."
        ),
    ),
    params(GetUnfurlQueryParams)
)]
#[tracing::instrument(skip(state))]
pub async fn get_unfurl_handler<T>(
    State(state): State<UnfurlRouterState<T>>,
    Query(params): Query<GetUnfurlQueryParams>,
) -> (StatusCode, Json<Option<GetUnfurlResponse>>)
where
    T: UnfurlService,
{
    match state.inner.unfurl(&params.url).await {
        Ok(response) => (StatusCode::OK, Json(Some(response))),
        Err(e) => {
            tracing::warn!(error = %e, url = %params.url, "unfurl failed");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(None))
        }
    }
}
