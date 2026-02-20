//! Axum router for document endpoints.
//!
//! Provides four routes:
//! - `POST /` — create a new document
//! - `GET /:document_id` — get document metadata
//! - `GET /:document_id/location_v3` — get document content location (presigned URL)
//! - `DELETE /:document_id` — soft-delete a document

#[cfg(test)]
mod tests;

use std::str::FromStr;
use std::sync::Arc;

use axum::{
    Extension, Json, Router,
    body::Body,
    extract::{FromRef, Path, Query, State},
    http::{HeaderMap, Request, StatusCode},
    middleware::{self, Next},
    response::IntoResponse,
};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::{
    DocumentAccessExtractor, InternalUser, ProjectBodyAccessLevelExtractor,
};
use model::document::response::{
    CreateDocumentRequest, CreateDocumentResponse, GetDocumentResponse,
};
use model::document::{DocumentBasic, FileType, FileTypeExt, response::LocationResponseV3};
use model::response::GenericSuccessResponse;
use model::user::UserContext;
use model_error_response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;
use models_permissions::share_permission::access_level::{
    EditAccessLevel, OwnerAccessLevel, ViewAccessLevel,
};
use serde::Deserialize;
use sqlx::PgPool;

use crate::domain::models::{CreateDocumentRepoArgs, DocumentError, LocationQueryParams};
use crate::domain::ports::DocumentService;

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

/// Build the documents router with all four endpoints.
pub fn documents_router<T, Svc, S>(state: DocumentRouterState<T, Svc>) -> Router<S>
where
    T: DocumentService,
    Svc: EntityAccessService,
    S: Send + Sync + 'static,
{
    // Routes that need ensure_document_exists middleware
    let document_id_routes = Router::new()
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
            state.clone(),
            ensure_document_exists,
        ));

    Router::new()
        .merge(document_id_routes)
        .route("/", axum::routing::post(create_document_handler::<T, Svc>))
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
                            message: &format!("document with id \"{}\" was not found", document_id),
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
                            message: "unknown error occurred",
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
#[tracing::instrument(skip(state, access), err)]
pub async fn get_document_handler<T: DocumentService, Svc: EntityAccessService>(
    State(state): State<DocumentRouterState<T, Svc>>,
    access: DocumentAccessExtractor<ViewAccessLevel, Svc>,
    user_context: Extension<UserContext>,
    Path(Params { document_id }): Path<Params>,
) -> Result<Json<GetDocumentResponse>, DocumentError> {
    let response_data = state
        .service
        .get_document(access.entity_access_receipt)
        .await?;

    Ok(Json(GetDocumentResponse {
        error: false,
        data: response_data,
    }))
}

// entity access
// do work

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
#[tracing::instrument(skip(state, access, document_context), err)]
pub async fn get_location_v3_handler<T: DocumentService, Svc: EntityAccessService>(
    access: DocumentAccessExtractor<ViewAccessLevel, Svc>,
    State(state): State<DocumentRouterState<T, Svc>>,
    Extension(document_context): Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
    Query(params): Query<LocationQueryParams>,
) -> Result<(HeaderMap, Json<LocationResponseV3>), DocumentError> {
    let response_data = state
        .service
        .get_document_location(&document_context, access.entity_access_receipt, params)
        .await?;

    let mut header_map = HeaderMap::new();
    header_map.append("content-type", "application/json".parse().unwrap());
    header_map.append("Cache-Control", "max-age-300".parse().unwrap());

    Ok((header_map, Json(response_data)))
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
#[tracing::instrument(skip(state, access, doc), err)]
pub async fn delete_document_handler<T: DocumentService, Svc: EntityAccessService>(
    access: DocumentAccessExtractor<OwnerAccessLevel, Svc>,
    State(state): State<DocumentRouterState<T, Svc>>,
    user_context: Extension<UserContext>,
    doc: Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
) -> Result<Json<GenericSuccessResponse>, DocumentError> {
    tracing::info!("delete document");

    state
        .service
        .delete_document(access.entity_access_receipt, doc.project_id.clone())
        .await?;

    Ok(Json(GenericSuccessResponse { success: true }))
}

/// Handler for `POST /documents`.
///
/// Creates a new document, generates an S3 presigned upload URL, and returns
/// the document metadata with the URL for the client to upload to.
#[utoipa::path(
    tag = "document",
    post,
    path = "/documents",
    operation_id = "create_document",
    request_body = CreateDocumentRequest,
    responses(
        (status = 200, body = inline(CreateDocumentResponse)),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, user_context, project), fields(user_id=?user_context.macro_user_id))]
pub async fn create_document_handler<T: DocumentService, Svc: EntityAccessService>(
    State(state): State<DocumentRouterState<T, Svc>>,
    internal_user: Option<Extension<InternalUser>>,
    user_context: MacroUserExtractor,
    project: ProjectBodyAccessLevelExtractor<EditAccessLevel, CreateDocumentRequest, Svc>,
) -> Result<Json<CreateDocumentResponse>, DocumentError> {
    let req = project.into_inner();

    // Email linking is internal only
    if req.email_attachment_id.is_some() && internal_user.is_none() {
        return Err(DocumentError::Unauthorized);
    }

    // Parse file type from the request
    let user_provided_file_type: Option<FileType> = req
        .file_type
        .as_deref()
        .and_then(|f| FileType::from_str(f).ok());

    let (document_name, file_type) = match user_provided_file_type {
        Some(file_type) => {
            let document_name = FileType::clean_document_name(&req.document_name);
            (document_name.unwrap_or(req.document_name), Some(file_type))
        }
        None => match FileType::split_suffix_match(req.document_name.as_str()) {
            Some((file_name, extension)) => {
                let file_type: Option<FileType> = FileType::from_str(extension).ok();
                (file_name.to_string(), file_type)
            }
            None => (req.document_name, None),
        },
    };

    // Log if the user-provided mime type does not match the file type
    if let (Some(ft), Some(user_mime_type)) = (file_type, &req.mime_type)
        && *user_mime_type != ft.mime_type()
    {
        tracing::warn!(
            file_type=?ft,
            mime_type=?user_mime_type,
            "provided mime type does not match file type"
        );
    }

    let args = CreateDocumentRepoArgs {
        id: req.id,
        sha: req.sha,
        document_name,
        user_id: user_context.macro_user_id.clone(),
        file_type,
        project_id: req.project_id,
        email_attachment_id: req.email_attachment_id,
        created_at: req.created_at,
        is_task: req.is_task,
        skip_history: req.skip_history,
    };

    let response_data = state
        .service
        .create_document(user_context.macro_user_id, args, req.job_id)
        .await?;

    Ok(Json(CreateDocumentResponse {
        error: false,
        data: response_data,
    }))
}
