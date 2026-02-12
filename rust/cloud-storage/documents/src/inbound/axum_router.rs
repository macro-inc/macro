//! Axum router for document endpoints.
//!
//! Provides three routes:
//! - `GET /:document_id` — get document metadata
//! - `GET /:document_id/location_v3` — get document content location (presigned URL)
//! - `DELETE /:document_id` — soft-delete a document

#[cfg(test)]
mod tests;

use std::sync::Arc;

use axum::{
    Extension, Json, Router,
    body::Body,
    extract::{FromRef, Path, Query, State},
    http::{Request, Response, StatusCode},
    middleware::{self, Next},
    response::IntoResponse,
};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::DocumentAccessExtractor;
use model::document::DocumentBasic;
use model::document::response::GetDocumentResponse;
use model::response::{GenericResponse, GenericSuccessResponse};
use model::user::UserContext;
use models_permissions::share_permission::access_level::{OwnerAccessLevel, ViewAccessLevel};
use serde::Deserialize;
use sqlx::PgPool;

use crate::domain::models::LocationQueryParams;
use crate::domain::ports::DocumentService;
use crate::outbound::pg_document_repo::PgDocumentRepo;

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

#[derive(Deserialize)]
struct Params {
    document_id: String,
}

/// Build the documents router with all three endpoints.
pub fn documents_router<T, Svc, S>(state: DocumentRouterState<T, Svc>) -> Router<S>
where
    T: DocumentService,
    Svc: EntityAccessService,
    S: Send + Sync + 'static,
{
    let pool_for_middleware = state.pool.clone();

    Router::new()
        .route(
            "/{document_id}",
            axum::routing::get(get_document_handler::<T, Svc>)
                .delete(delete_document_handler::<T, Svc>),
        )
        .route(
            "/{document_id}/location_v3",
            axum::routing::get(get_location_v3_handler::<T, Svc>),
        )
        .layer(middleware::from_fn_with_state(
            pool_for_middleware,
            ensure_document_exists,
        ))
        .with_state(state)
}

/// Middleware that loads [`DocumentBasic`] into request extensions.
///
/// Extracts `document_id` from the path and queries the database.
/// Returns 404 if the document does not exist.
async fn ensure_document_exists(
    State(pool): State<PgPool>,
    request: Request<Body>,
    next: Next,
) -> impl IntoResponse {
    // Extract document_id from the URI path
    let document_id = request
        .uri()
        .path()
        .split('/')
        .find(|s| !s.is_empty())
        .map(|s| s.to_string());

    let document_id = match document_id {
        Some(id) => id,
        None => return StatusCode::BAD_REQUEST.into_response(),
    };

    let repo = PgDocumentRepo::new(pool);
    let document_basic = match crate::domain::ports::DocumentRepo::get_basic_document(
        &repo,
        &document_id,
    )
    .await
    {
        Ok(doc) => doc,
        Err(e) => {
            tracing::error!(error=?e, document_id=?document_id, "document not found");
            return StatusCode::NOT_FOUND.into_response();
        }
    };

    let mut request = request;
    request.extensions_mut().insert(document_basic);
    next.run(request).await.into_response()
}

/// Handler for `GET /documents/:document_id`.
///
/// Returns document metadata, user access level, and view location.
async fn get_document_handler<T: DocumentService, Svc: EntityAccessService>(
    State(state): State<DocumentRouterState<T, Svc>>,
    access: DocumentAccessExtractor<ViewAccessLevel, Svc>,
    user_context: Extension<UserContext>,
    Path(Params { document_id }): Path<Params>,
) -> Result<Json<GetDocumentResponse>, StatusCode> {
    let response_data = state
        .service
        .get_document(&user_context.user_id, &document_id, access.access_level)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to get document");
            match e {
                crate::domain::models::DocumentError::NotFound(_) => StatusCode::NOT_FOUND,
                crate::domain::models::DocumentError::Unauthorized => StatusCode::UNAUTHORIZED,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            }
        })?;

    Ok(Json(GetDocumentResponse {
        error: false,
        data: response_data,
    }))
}

/// Handler for `GET /documents/:document_id/location_v3`.
///
/// Returns a presigned URL or sync service content for accessing the document.
async fn get_location_v3_handler<T: DocumentService, Svc: EntityAccessService>(
    _access: DocumentAccessExtractor<ViewAccessLevel, Svc>,
    State(state): State<DocumentRouterState<T, Svc>>,
    Extension(document_context): Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
    Query(params): Query<LocationQueryParams>,
) -> impl IntoResponse {
    match state
        .service
        .get_document_location(&document_context, &document_id, params)
        .await
    {
        Ok(response_data) => {
            let json_bytes = serde_json::to_vec(&response_data).unwrap();
            Response::builder()
                .status(StatusCode::OK)
                .header("content-type", "application/json")
                .header("Cache-Control", "max-age=300")
                .body(Body::from(json_bytes))
                .unwrap()
        }
        Err(e) => {
            tracing::error!(error=?e, "unable to get document location");
            let status_code = match e {
                crate::domain::models::DocumentError::Gone => StatusCode::GONE,
                crate::domain::models::DocumentError::NotFound(_) => StatusCode::NOT_FOUND,
                crate::domain::models::DocumentError::Unauthorized => StatusCode::UNAUTHORIZED,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            GenericResponse::builder()
                .message("unable to get document location")
                .is_error(true)
                .send(status_code)
        }
    }
}

/// Handler for `DELETE /documents/:document_id`.
///
/// Soft-deletes a document (only owners can delete).
async fn delete_document_handler<T: DocumentService, Svc: EntityAccessService>(
    _access: DocumentAccessExtractor<OwnerAccessLevel, Svc>,
    State(state): State<DocumentRouterState<T, Svc>>,
    user_context: Extension<UserContext>,
    doc: Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
) -> impl IntoResponse {
    tracing::info!("delete document");

    if let Err(e) = state
        .service
        .delete_document(
            &document_id,
            doc.project_id.clone(),
            user_context.user_id.clone(),
        )
        .await
    {
        tracing::error!(error=?e, "unable to delete document");
        return GenericResponse::builder()
            .message("unable to delete document")
            .is_error(true)
            .send(StatusCode::INTERNAL_SERVER_ERROR);
    }

    let response_data = GenericSuccessResponse { success: true };

    GenericResponse::builder()
        .data(&response_data)
        .send(StatusCode::OK)
}
