//! PowerPoint routes: read a deck as text, apply an atomic batch of edit
//! operations, or save an edited copy, through the same presentation service
//! and access checks as the ReadPresentation and EditPresentation tools.

use super::DocumentRouterState;
use crate::domain::{
    create::{NewDocumentMetadata, NonMarkdownFileType},
    models::DocumentError,
    ports::{DocumentService, create::DocumentCreationService},
    presentation::{PresentationEditOutcome, PresentationError},
};
use axum::{
    Extension, Json,
    extract::{State, rejection::JsonRejection},
};
use axum_extra::extract::Query;
use entity_access::{
    domain::{
        models::{EditAccessLevel, EntityType, ViewAccessLevel},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::{DocumentAccessExtractor, principal_entity_access_receipt},
};
use entity_registry::CreationPrincipalExtractor;
use macro_authorization::{AnyPrincipal, MacroAuthorizationExtractor, MacroAuthorizationService};
use pptx_engine::EditOp;
use shared_types::document::{DocumentBasic, FileType};

/// Which slides to read.
#[derive(Debug, Default, serde::Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct PresentationReadQuery {
    /// 1-based slide numbers to read; omit for the whole deck.
    #[serde(default, rename = "slide")]
    #[param(style = Form, explode)]
    pub slides: Vec<u32>,
}

/// A presentation described as text.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct PresentationDescription {
    /// Slide size, layouts, theme colors, and each slide's id, layout and
    /// shapes (ids, kinds, positions and sizes in points, text, tables,
    /// charts, pictures), plus sections, masters, comments and notes.
    pub content: String,
}

/// An atomic batch of edit operations.
#[derive(Debug, serde::Deserialize, utoipa::ToSchema)]
pub struct PresentationEditRequest {
    /// Operations validated and committed together, in order: 1 to 100.
    pub operations: Vec<EditOp>,
}

/// Where an edited copy of a presentation is created.
#[derive(Debug, serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PresentationCopyRequest {
    /// Name of the new presentation, without the `.pptx` extension.
    #[schema(min_length = 1)]
    pub name: String,
    /// Project to create it in; defaults to the original's project when the
    /// caller can edit it.
    #[serde(default)]
    pub project_id: Option<uuid::Uuid>,
    /// Operations to apply to the copy, at most 100; none for a plain copy.
    #[serde(default)]
    pub operations: Vec<EditOp>,
}

fn ensure_presentation(document: &DocumentBasic) -> Result<(), DocumentError> {
    if document.try_file_type() != Some(FileType::Pptx) {
        return Err(DocumentError::BadRequest(
            "the document is not a PowerPoint (.pptx) presentation".to_string(),
        ));
    }
    Ok(())
}

/// Operations the engine rejects are the caller's to fix; the rest are ours.
fn presentation_error(error: anyhow::Error) -> DocumentError {
    match error.downcast_ref::<PresentationError>() {
        Some(rejected) => DocumentError::BadRequest(rejected.to_string()),
        None => DocumentError::Internal(error),
    }
}

/// Read a PowerPoint deck as text with the caller's view access: every
/// slide's id and shapes with their ids, positions and text. Edits address
/// slides and shapes by these ids, which are not slide numbers.
#[utoipa::path(
    get,
    tag = "document",
    path = "/documents/{document_id}/presentation",
    operation_id = "read_presentation",
    params(
        ("document_id" = String, Path, description = "Document identity"),
        PresentationReadQuery
    ),
    responses(
        (status = 200, body = PresentationDescription),
        (status = 400, description = "Not a readable PowerPoint presentation", body = model_error_response::ErrorResponse),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Document access denied"),
        (status = 404, description = "Document not found"),
        (status = 500, body = model_error_response::ErrorResponse)
    )
)]
#[tracing::instrument(skip_all, fields(document_id = %document.document_id, slides = query.slides.len()), err)]
pub async fn read_presentation_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<ViewAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    // Request-local metadata from validate_document_exists_middleware, not a shared service.
    // ast-grep-ignore: rust-no-axum-extension-param
    Extension(document): Extension<DocumentBasic>,
    Query(query): Query<PresentationReadQuery>,
) -> Result<Json<PresentationDescription>, DocumentError> {
    ensure_presentation(&document)?;
    let slides: Option<Vec<usize>> = (!query.slides.is_empty())
        .then(|| query.slides.iter().map(|&slide| slide as usize).collect());
    let content = state
        .presentations
        .read(access.entity_access_receipt, slides.as_deref())
        .await
        .map_err(presentation_error)?;
    Ok(Json(PresentationDescription { content }))
}

/// Apply a batch of edit operations to a PowerPoint deck atomically with the
/// caller's edit access, saved as a new version. If any operation fails,
/// nothing is saved.
#[utoipa::path(
    post,
    tag = "document",
    path = "/documents/{document_id}/presentation/edits",
    operation_id = "edit_presentation",
    params(("document_id" = String, Path, description = "Document identity")),
    request_body = PresentationEditRequest,
    responses(
        (status = 200, body = PresentationEditOutcome),
        (status = 400, description = "Not a PowerPoint presentation, a batch outside 1 to 100 operations, or an operation the deck rejected; nothing was saved", body = model_error_response::ErrorResponse),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Document edit access denied"),
        (status = 404, description = "Document not found"),
        (status = 500, body = model_error_response::ErrorResponse)
    )
)]
#[tracing::instrument(
    skip_all,
    fields(document_id = %document.document_id, operations = tracing::field::Empty),
    err
)]
pub async fn edit_presentation_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<EditAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    // Request-local metadata from validate_document_exists_middleware, not a shared service.
    // ast-grep-ignore: rust-no-axum-extension-param
    Extension(document): Extension<DocumentBasic>,
    body: Result<Json<PresentationEditRequest>, JsonRejection>,
) -> Result<Json<PresentationEditOutcome>, DocumentError> {
    let Json(request) =
        body.map_err(|rejection| DocumentError::BadRequest(rejection.body_text()))?;
    ensure_presentation(&document)?;
    tracing::Span::current().record("operations", request.operations.len());
    state
        .presentations
        .edit(access.entity_access_receipt, &request.operations)
        .await
        .map(Json)
        .map_err(presentation_error)
}

/// Create an edited copy of a PowerPoint deck as a new presentation, leaving
/// the original unchanged. Needs view access to the deck and edit access to
/// the destination project; the outcome's `documentId` is the copy.
#[utoipa::path(
    post,
    tag = "document",
    path = "/documents/{document_id}/presentation/copy",
    operation_id = "copy_presentation",
    params(("document_id" = String, Path, description = "Document identity")),
    request_body = PresentationCopyRequest,
    responses(
        (status = 200, body = PresentationEditOutcome),
        (status = 400, description = "Not a PowerPoint presentation, an empty name, more than 100 operations, or an operation the deck rejected; nothing was created", body = model_error_response::ErrorResponse),
        (status = 401, description = "No edit access to the destination project", body = model_error_response::ErrorResponse),
        (status = 403, description = "Document access denied, or the caller cannot create documents"),
        (status = 404, description = "Document not found"),
        (status = 422, description = "Document name exceeds the maximum length"),
        (status = 500, body = model_error_response::ErrorResponse)
    )
)]
#[tracing::instrument(
    skip_all,
    fields(document_id = %document.document_id, operations = tracing::field::Empty),
    err
)]
pub async fn copy_presentation_handler<
    T: DocumentService + DocumentCreationService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<ViewAccessLevel, Svc, Auth>,
    CreationPrincipalExtractor { principal, .. }: CreationPrincipalExtractor<Auth>,
    caller: MacroAuthorizationExtractor<Auth, AnyPrincipal>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    // Request-local metadata from validate_document_exists_middleware, not a shared service.
    // ast-grep-ignore: rust-no-axum-extension-param
    Extension(document): Extension<DocumentBasic>,
    body: Result<Json<PresentationCopyRequest>, JsonRejection>,
) -> Result<Json<PresentationEditOutcome>, DocumentError> {
    let Json(request) =
        body.map_err(|rejection| DocumentError::BadRequest(rejection.body_text()))?;
    ensure_presentation(&document)?;
    tracing::Span::current().record("operations", request.operations.len());
    let name = request.name.trim().trim_end_matches(".pptx").trim();
    if name.is_empty() {
        return Err(DocumentError::BadRequest(
            "name must name the new presentation".to_string(),
        ));
    }

    let project_id = match request.project_id {
        Some(project_id) => {
            principal_entity_access_receipt::<EditAccessLevel>(
                state.access_service.as_ref(),
                &caller.authorization,
                &project_id.to_string(),
                EntityType::Project,
            )
            .await
            .map_err(|error| {
                tracing::info!(error = ?error, "presentation copy destination project denied");
                DocumentError::Unauthorized
            })?;
            Some(project_id)
        }
        None => original_project(&state, &caller, &document).await,
    };

    let (bytes, mut outcome) = state
        .presentations
        .edited_copy(access.entity_access_receipt, &request.operations)
        .await
        .map_err(presentation_error)?;
    let mut metadata = NewDocumentMetadata::builder(name.to_string());
    if let Some(project_id) = project_id {
        metadata = metadata.project_id(project_id);
    }
    let file_type = NonMarkdownFileType::new(FileType::Pptx)?;
    let created = state
        .creator
        .create_file(&principal, metadata.build(), file_type, bytes)
        .await?;
    outcome.document_id = created.document_id().to_string();
    Ok(Json(outcome))
}

/// The original's project, when the caller may add documents to it.
async fn original_project<T, Svc: EntityAccessService, Auth>(
    state: &DocumentRouterState<T, Svc, Auth>,
    caller: &MacroAuthorizationExtractor<Auth, AnyPrincipal>,
    document: &DocumentBasic,
) -> Option<uuid::Uuid> {
    let project_id = document.project_id.as_deref()?;
    principal_entity_access_receipt::<EditAccessLevel>(
        state.access_service.as_ref(),
        &caller.authorization,
        project_id,
        EntityType::Project,
    )
    .await
    .ok()?;
    project_id.parse().ok()
}
