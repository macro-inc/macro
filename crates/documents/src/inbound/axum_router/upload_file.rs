//! Handler for `POST /documents/upload`: create a document from the request's
//! raw bytes, through the same upload use case as the UploadFile tool.
//!
//! Callers that can only reach Macro hosts, such as code-mode programs, cannot
//! PUT to the presigned object-storage URL `POST /documents` returns, so this
//! route takes the bytes itself and uploads them server side.

use axum::{
    Json,
    body::Bytes,
    extract::{Query, State},
};
use entity_access::domain::models::{EditAccessLevel, EntityType};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::principal_entity_access_receipt;
use entity_registry::CreationPrincipalExtractor;
use macro_authorization::{AnyPrincipal, MacroAuthorizationExtractor, MacroAuthorizationService};

use super::DocumentRouterState;
use crate::domain::create::upload::NewFileUpload;
use crate::domain::models::DocumentError;
use crate::domain::ports::DocumentService;
use crate::domain::ports::create::DocumentCreationService;

/// Where the uploaded file goes and what it is called.
#[derive(Debug, serde::Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query, rename_all = "camelCase")]
pub struct UploadFileQuery {
    /// Filename including its extension, such as `report.pdf`; the extension
    /// sets the file type. No directory components.
    pub file_name: String,
    /// Destination project. Requires edit access; omit for top-level files.
    pub project_id: Option<uuid::Uuid>,
}

/// A file's raw bytes, as the request body.
pub struct FileBytes;

impl utoipa::PartialSchema for FileBytes {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        use utoipa::openapi::schema::{KnownFormat, ObjectBuilder, SchemaFormat, Type};
        ObjectBuilder::new()
            .schema_type(Type::String)
            .format(Some(SchemaFormat::KnownFormat(KnownFormat::Binary)))
            .into()
    }
}

impl utoipa::ToSchema for FileBytes {}

/// The document created from the uploaded bytes.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UploadFileResponse {
    /// The new document.
    pub document_id: String,
    /// Number of bytes stored.
    pub size_bytes: usize,
}

/// Upload a file's bytes as a new document, up to 25 MiB.
///
/// The body is the raw file content. Preview generation and indexing may
/// finish after the response.
#[utoipa::path(
    tag = "document",
    post,
    path = "/documents/upload",
    operation_id = "upload_file",
    params(UploadFileQuery),
    request_body(content = inline(FileBytes), content_type = "application/octet-stream", description = "The file's bytes, at most 25 MiB."),
    responses(
        (status = 200, body = UploadFileResponse),
        (status = 400, description = "Invalid filename or content", body = model_error_response::ErrorResponse),
        (status = 401, description = "No edit access to the destination project", body = model_error_response::ErrorResponse),
        (status = 403, description = "The caller cannot create documents"),
        (status = 413, description = "The file exceeds 25 MiB"),
        (status = 422, description = "Document name exceeds the maximum length", body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, fields(size_bytes = body.len()), err)]
pub async fn upload_file_handler<
    T: DocumentService + DocumentCreationService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    CreationPrincipalExtractor { principal, .. }: CreationPrincipalExtractor<Auth>,
    caller: MacroAuthorizationExtractor<Auth, AnyPrincipal>,
    Query(query): Query<UploadFileQuery>,
    body: Bytes,
) -> Result<Json<UploadFileResponse>, DocumentError> {
    let project = match query.project_id {
        Some(project_id) => Some(
            principal_entity_access_receipt::<EditAccessLevel>(
                state.access_service.as_ref(),
                &caller.authorization,
                &project_id.to_string(),
                EntityType::Project,
            )
            .await
            .map_err(|error| {
                tracing::info!(error = ?error, "upload destination project denied");
                DocumentError::Unauthorized
            })?,
        ),
        None => None,
    };
    let size_bytes = body.len();
    let created = state
        .creator
        .upload_file(
            &principal,
            NewFileUpload {
                file_name: query.file_name,
                bytes: body.into(),
                project,
            },
        )
        .await?;
    Ok(Json(UploadFileResponse {
        document_id: created.document_id().to_string(),
        size_bytes,
    }))
}
