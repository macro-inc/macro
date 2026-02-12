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
use model::response::GenericSuccessResponse;
use model::user::UserContext;
use model_error_response::ErrorResponse;
use models_permissions::share_permission::access_level::{
    AccessLevel, OwnerAccessLevel, ViewAccessLevel,
};
use serde::Deserialize;
use sqlx::PgPool;

use crate::domain::models::{DocumentError, LocationQueryParams};
use crate::domain::ports::DocumentService;
use crate::outbound::pg_document_repo::PgDocumentRepo;

impl IntoResponse for DocumentError {
    fn into_response(self) -> axum::response::Response {
        let status_code = match &self {
            DocumentError::NotFound(_) => StatusCode::NOT_FOUND,
            DocumentError::Unauthorized => StatusCode::UNAUTHORIZED,
            DocumentError::Gone => StatusCode::GONE,
            DocumentError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        if status_code.is_server_error() {
            tracing::error!(error=?self, "internal server error");
        }

        let message = self.to_string();
        (status_code, Json(ErrorResponse { message: &message })).into_response()
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
            "/:document_id",
            axum::routing::get(get_document_handler::<T, Svc>)
                .delete(delete_document_handler::<T, Svc>),
        )
        .route(
            "/:document_id/location_v3",
            axum::routing::get(get_location_v3_handler::<T, Svc>),
        )
        .layer(middleware::from_fn_with_state(
            pool_for_middleware,
            ensure_document_exists,
        ))
        .with_state(state)
}

/// Path parameters for document endpoints.
pub struct DocumentIdPathParams {
    /// The document ID.
    pub document_id: String,
}

/// Middleware that loads [`DocumentBasic`] into request extensions.
///
/// Extracts `document_id` from the path and queries the database.
/// Returns 404 if the document does not exist.
async fn ensure_document_exists(
    State(pool): State<PgPool>,
    Path(Params { document_id }): Path<Params>,
    request: Request<Body>,
    next: Next,
) -> impl IntoResponse {
    let repo = PgDocumentRepo::new(pool);
    let document_basic =
        match crate::domain::ports::DocumentRepo::get_basic_document(&repo, &document_id).await {
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
#[utoipa::path(
    tag = "document",
    get,
    path = "/documents/{document_id}",
    operation_id = "get_document",
    params(
        ("document_id" = String, Path, description = "Document ID")
    ),
    responses(
        (status = 200, body = GetDocumentResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn get_document_handler<T: DocumentService, Svc: EntityAccessService>(
    State(state): State<DocumentRouterState<T, Svc>>,
    access: DocumentAccessExtractor<ViewAccessLevel, Svc>,
    user_context: Extension<UserContext>,
    Path(Params { document_id }): Path<Params>,
) -> Result<Json<GetDocumentResponse>, DocumentError> {
    let response_data = state
        .service
        .get_document(&user_context.user_id, &document_id, access.access_level)
        .await?;

    Ok(Json(GetDocumentResponse {
        error: false,
        data: response_data,
    }))
}

/// Handler for `GET /documents/:document_id/location_v3`.
///
/// Returns a presigned URL or sync service content for accessing the document.
#[utoipa::path(
    tag = "document",
    get,
    path = "/documents/{document_id}/location_v3",
    operation_id = "get_document_location_v3",
    params(
        ("document_id" = String, Path, description = "Document ID"),
        ("document_version_id" = Option<i64>, Query, description = "A specific document version id to get the location for."),
        ("get_converted_docx_url" = Option<bool>, Query, description = "If true, this will return the converted docx url.")
    ),
    responses(
        (status = 200),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 410, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn get_location_v3_handler<T: DocumentService, Svc: EntityAccessService>(
    _access: DocumentAccessExtractor<ViewAccessLevel, Svc>,
    State(state): State<DocumentRouterState<T, Svc>>,
    Extension(document_context): Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
    Query(params): Query<LocationQueryParams>,
) -> Result<Response<Body>, DocumentError> {
    let response_data = state
        .service
        .get_document_location(&document_context, &document_id, params)
        .await?;

    let json_bytes = serde_json::to_vec(&response_data).unwrap();
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "application/json")
        .header("Cache-Control", "max-age=300")
        .body(Body::from(json_bytes))
        .unwrap())
}

/// Handler for `DELETE /documents/:document_id`.
///
/// Soft-deletes a document (only owners can delete).
#[utoipa::path(
    tag = "document",
    delete,
    path = "/documents/{document_id}",
    operation_id = "delete_document",
    params(
        ("document_id" = String, Path, description = "Document ID")
    ),
    responses(
        (status = 200, body = GenericSuccessResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn delete_document_handler<T: DocumentService, Svc: EntityAccessService>(
    _access: DocumentAccessExtractor<OwnerAccessLevel, Svc>,
    State(state): State<DocumentRouterState<T, Svc>>,
    user_context: Extension<UserContext>,
    doc: Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
) -> Result<Json<GenericSuccessResponse>, DocumentError> {
    tracing::info!("delete document");

    state
        .service
        .delete_document(
            &document_id,
            doc.project_id.clone(),
            user_context.user_id.clone(),
        )
        .await?;

    Ok(Json(GenericSuccessResponse { success: true }))
}

/// Marker struct for internal service-to-service requests.
///
/// Middleware inserts this into request extensions for authenticated internal callers.
#[derive(Debug, Clone)]
pub struct InternalUser {
    /// The access level granted to the internal user.
    pub access_level: AccessLevel,
}

/// Handler for `GET /documents/:document_id` (internal route).
///
/// Accepts either a regular access extractor or an internal user extension.
#[tracing::instrument(skip(state, user_context, access), fields(user_id=?user_context.user_id))]
pub async fn internal_get_document_handler<T: DocumentService, Svc: EntityAccessService>(
    State(state): State<DocumentRouterState<T, Svc>>,
    access: axum_extra::either::Either<
        DocumentAccessExtractor<ViewAccessLevel, Svc>,
        Option<Extension<InternalUser>>,
    >,
    user_context: Extension<UserContext>,
    Path(Params { document_id }): Path<Params>,
) -> Result<Json<GetDocumentResponse>, DocumentError> {
    let access_level = match access {
        axum_extra::either::Either::E1(extractor) => extractor.access_level,
        axum_extra::either::Either::E2(Some(Extension(InternalUser { access_level }))) => {
            access_level
        }
        axum_extra::either::Either::E2(None) => return Err(DocumentError::Unauthorized),
    };

    let response_data = state
        .service
        .get_document(&user_context.user_id, &document_id, access_level)
        .await?;

    Ok(Json(GetDocumentResponse {
        error: false,
        data: response_data,
    }))
}

/// Handler for `GET /documents/:document_id/location_v3` (internal route).
///
/// Delegates to the document service without access checking.
#[tracing::instrument(skip(state, document_context))]
pub async fn internal_get_location_v3_handler<T: DocumentService, Svc: EntityAccessService>(
    State(state): State<DocumentRouterState<T, Svc>>,
    Extension(document_context): Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
    Query(params): Query<LocationQueryParams>,
) -> Result<Response<Body>, DocumentError> {
    let response_data = state
        .service
        .get_document_location(&document_context, &document_id, params)
        .await?;

    let json_bytes = serde_json::to_vec(&response_data).unwrap();
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "application/json")
        .header("Cache-Control", "max-age=300")
        .body(Body::from(json_bytes))
        .unwrap())
}
