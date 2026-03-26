//! Axum router for document endpoints.
//!
//! Provides routes:
//! - `POST /` — create a new document
//! - `GET /{document_id}` — get document metadata
//! - `GET /{document_id}/location_v3` — get document content location (presigned URL)
//! - `GET /{document_id}/short_id` — get document short ID
//! - `DELETE /{document_id}` — soft-delete a document

#[cfg(test)]
mod tests;

mod create_document;
mod create_task;
mod delete_document;
mod edit_document;
mod get_document;
mod get_location;
mod get_short_id;

use std::sync::Arc;

use axum::{
    Json, Router,
    body::Body,
    extract::{FromRef, Path, State},
    http::{Request, StatusCode},
    middleware::{self, Next},
    response::IntoResponse,
};
use entity_access::domain::ports::EntityAccessService;
use model_error_response::ErrorResponse;
use serde::Deserialize;
use sqlx::PgPool;

use crate::domain::models::DocumentError;
use crate::domain::ports::DocumentService;

// Re-export handlers and utoipa path types for external use (swagger, internal routes)
pub use create_document::*;
pub use create_task::*;
pub use delete_document::*;
pub use edit_document::*;
pub use get_document::*;
pub use get_location::*;
pub use get_short_id::*;

impl IntoResponse for DocumentError {
    fn into_response(self) -> axum::response::Response {
        let status_code = match &self {
            DocumentError::NotFound(_) => StatusCode::NOT_FOUND,
            DocumentError::Unauthorized => StatusCode::UNAUTHORIZED,
            DocumentError::Gone => StatusCode::GONE,
            DocumentError::Conflict(_) => StatusCode::CONFLICT,
            DocumentError::BadRequest(_) => StatusCode::BAD_REQUEST,
            DocumentError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        if status_code.is_server_error() {
            tracing::error!(error=?self, "internal server error");
        }

        let message = self.to_string();
        (
            status_code,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}

/// Router state containing the document service, entity access service, and DB pool.
pub struct DocumentRouterState<T, Svc> {
    /// The document service implementation.
    pub service: Arc<T>,
    /// The entity access service for authorization.
    pub access_service: Arc<Svc>,
    /// The database pool (used by middleware for document lookups).
    pub pool: PgPool,
}

// Manual Clone impl so T and Svc don't need to be Clone (they're behind Arc).
impl<T, Svc> Clone for DocumentRouterState<T, Svc> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            access_service: self.access_service.clone(),
            pool: self.pool.clone(),
        }
    }
}

impl<T, Svc> FromRef<DocumentRouterState<T, Svc>> for Arc<Svc> {
    fn from_ref(state: &DocumentRouterState<T, Svc>) -> Self {
        state.access_service.clone()
    }
}

/// Path parameters for document endpoints (document_id extraction).
#[derive(Deserialize)]
pub struct Params {
    document_id: String,
}

/// Build the documents router with all endpoints.
pub fn documents_router<T, Svc, S>(state: DocumentRouterState<T, Svc>) -> Router<S>
where
    T: DocumentService,
    Svc: EntityAccessService,
    S: Send + Sync + 'static,
{
    // Routes that need ensure_document_exists middleware
    let document_id_routes = Router::new()
        .route(
            "/{document_id}",
            axum::routing::get(get_document_handler::<T, Svc>)
                .patch(edit_document_handler::<T, Svc>)
                .delete(delete_document_handler::<T, Svc>),
        )
        .route(
            "/{document_id}/location_v3",
            axum::routing::get(get_location_v3_handler::<T, Svc>),
        )
        .route(
            "/{document_id}/short_id",
            axum::routing::get(get_short_id_handler::<T, Svc>),
        )
        .layer(middleware::from_fn_with_state(
            state.clone(),
            ensure_document_exists,
        ));

    Router::new()
        .merge(document_id_routes)
        .route("/", axum::routing::post(create_document_handler::<T, Svc>))
        .route(
            "/create_task",
            axum::routing::post(create_task_handler::<T, Svc>),
        )
        .with_state(state)
}

/// Path parameters for document endpoints.
pub struct DocumentIdPathParams {
    /// The document ID.
    pub document_id: String,
}

/// Middleware that loads [`DocumentBasic`](model::document::DocumentBasic) into request extensions.
///
/// Extracts `document_id` from the path and queries the database.
/// Returns 404 if the document does not exist.
#[tracing::instrument(skip(state, request, next))]
async fn ensure_document_exists<T: DocumentService, Svc: EntityAccessService>(
    State(state): State<DocumentRouterState<T, Svc>>,
    Path(Params { document_id }): Path<Params>,
    request: Request<Body>,
    next: Next,
) -> impl IntoResponse {
    let document_basic = match state
        .service
        .internal_get_basic_document(&document_id)
        .await
    {
        Ok(doc) => doc,
        Err(e) => {
            match e {
                DocumentError::NotFound(_) => {
                    return (
                        StatusCode::NOT_FOUND,
                        Json(ErrorResponse {
                            message: format!("document with id \"{}\" was not found", document_id)
                                .into(),
                        }),
                    )
                        .into_response();
                }
                _ => {
                    // Only other type that we return here is DocumentError::Internal
                    tracing::error!(error=?e, document_id=?document_id, "unable to check if document exists");
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(ErrorResponse {
                            message: "unknown error occurred".into(),
                        }),
                    )
                        .into_response();
                }
            }
        }
    };

    let mut request = request;
    request.extensions_mut().insert(document_basic);
    next.run(request).await.into_response()
}
