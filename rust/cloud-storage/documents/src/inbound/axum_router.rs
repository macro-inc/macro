//! Axum router for document endpoints.
//!
//! Provides routes:
//! - `POST /` — create a new document
//! - `GET /{document_id}` — get document metadata
//! - `GET /{document_id}/location_v3` — get document content location (presigned URL)
//! - `GET /{document_id}/branch_name` — get short ID + task-aware git branch name (when the document is a task)
//! - `GET /{document_id}/github_prs` — get GitHub pull requests associated with a task document
//! - `GET /{document_id}/short_id` — get document short ID
//! - `POST /create_markdown` — create and initialize a markdown document
//! - `DELETE /{document_id}` — soft-delete a document

#[cfg(test)]
mod tests;

pub mod copy_document;
pub mod create_document;
#[cfg(feature = "document_create")]
pub mod create_markdown;
pub mod create_task;
pub mod delete_document;
pub mod edit_document;
pub mod get_branch_name;
pub mod get_document;
pub mod get_github_pull_requests;
pub mod get_location;
pub mod get_short_id;
pub mod task_duplicates;

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
use task_dedup::PgTaskDedupService;

#[cfg(feature = "document_create")]
use self::create_markdown::create_markdown_handler;
use self::{
    copy_document::copy_document_handler,
    create_document::create_document_handler,
    create_task::create_task_handler,
    delete_document::delete_document_handler,
    edit_document::edit_document_handler,
    get_branch_name::get_branch_name_handler,
    get_document::get_document_handler,
    get_github_pull_requests::get_github_pull_requests_handler,
    get_location::get_location_v3_handler,
    get_short_id::get_short_id_handler,
    task_duplicates::{
        delete_this_duplicate_task_handler, dismiss_task_duplicates_handler,
        get_task_duplicates_handler, task_similarity_search_handler,
    },
};

use crate::domain::models::DocumentError;
use crate::domain::ports::DocumentService;
#[cfg(feature = "document_create")]
use crate::domain::ports::create::DocumentCreationService;

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

/// Default backend-owned document creation use case for the document router.
#[cfg(feature = "document_create_adapters")]
pub type DefaultDocumentCreator<T> = crate::domain::create::DocumentCreator<
    Arc<T>,
    crate::outbound::markdown_init::LexicalSyncMarkdownInitializer,
    crate::outbound::document_bytes_upload::ReqwestDocumentBytesUploader,
>;

/// Router state containing document router dependencies.
pub struct DocumentRouterState<T, Svc> {
    /// The document service implementation.
    pub service: Arc<T>,
    /// The entity access service for authorization.
    pub access_service: Arc<Svc>,
    /// The database pool (used by middleware for document lookups).
    pub pool: PgPool,
    /// Task duplicate detection service.
    pub task_dedup_service: Arc<PgTaskDedupService>,
    /// Backend-owned document creation use case.
    #[cfg(feature = "document_create_adapters")]
    pub creator: DefaultDocumentCreator<T>,
}

// Manual Clone impl so T and Svc don't need to be Clone (they're behind Arc).
impl<T, Svc> Clone for DocumentRouterState<T, Svc> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            access_service: self.access_service.clone(),
            pool: self.pool.clone(),
            task_dedup_service: self.task_dedup_service.clone(),
            #[cfg(feature = "document_create_adapters")]
            creator: self.creator.clone(),
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
    T: DocumentService + DocumentCreationService,
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
            "/{document_id}/branch_name",
            axum::routing::get(get_branch_name_handler::<T, Svc>),
        )
        .route(
            "/{document_id}/github_prs",
            axum::routing::get(get_github_pull_requests_handler::<T, Svc>),
        )
        .route(
            "/{document_id}/short_id",
            axum::routing::get(get_short_id_handler::<T, Svc>),
        )
        .route(
            "/{document_id}/copy",
            axum::routing::post(copy_document_handler::<T, Svc>),
        )
        .route(
            "/{document_id}/duplicates",
            axum::routing::get(get_task_duplicates_handler::<T, Svc>),
        )
        .route(
            "/{document_id}/duplicates/dismiss",
            axum::routing::post(dismiss_task_duplicates_handler::<T, Svc>),
        )
        .route(
            "/{document_id}/duplicates/{match_id}/delete_this",
            axum::routing::post(delete_this_duplicate_task_handler::<T, Svc>),
        );

    let document_id_routes = document_id_routes.layer(middleware::from_fn_with_state(
        state.clone(),
        ensure_document_exists,
    ));

    let router = Router::new()
        .merge(document_id_routes)
        .route("/", axum::routing::post(create_document_handler::<T, Svc>))
        .route(
            "/create_task",
            axum::routing::post(create_task_handler::<T, Svc>),
        )
        .route(
            "/similarity_search",
            axum::routing::post(task_similarity_search_handler::<T, Svc>),
        );

    #[cfg(feature = "document_create")]
    let router = router.route(
        "/create_markdown",
        axum::routing::post(create_markdown_handler::<T, Svc>),
    );

    router.with_state(state)
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
