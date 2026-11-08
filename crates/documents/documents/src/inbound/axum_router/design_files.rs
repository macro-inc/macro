//! Design file routes: read a Figma design, Photoshop document or
//! Illustrator document as text, through the same services and view access
//! check as the ReadDesign, ReadPhotoshopDocument and ReadIllustratorDocument
//! tools. These files are read here, never written.

use super::DocumentRouterState;
use crate::domain::{
    design::DesignError, illustrator::IllustratorError, models::DocumentError,
    photoshop::PhotoshopError, ports::DocumentService,
};
use axum::{Extension, Json, extract::State};
use axum_extra::extract::Query;
use entity_access::{
    domain::{models::ViewAccessLevel, ports::EntityAccessService},
    inbound::axum_extractors::DocumentAccessExtractor,
};
use macro_authorization::MacroAuthorizationService;
use shared_types::document::{DocumentBasic, FileType};

/// Which pages of a design to read.
#[derive(Debug, Default, serde::Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct DesignReadQuery {
    /// 1-based page numbers to read; omit for the whole design.
    #[serde(default, rename = "page")]
    #[param(style = Form, explode)]
    pub pages: Vec<u32>,
}

/// A design file described as text.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct DesignFileDescription {
    /// The description: pages or artboards, the layer tree, and the text of
    /// text layers.
    pub content: String,
}

fn ensure_file_type(
    document: &DocumentBasic,
    expected: &[FileType],
    kind: &str,
) -> Result<(), DocumentError> {
    match document.try_file_type() {
        Some(file_type) if expected.contains(&file_type) => Ok(()),
        _ => Err(DocumentError::BadRequest(format!(
            "the document is not {kind}"
        ))),
    }
}

/// Files the readers cannot open are the caller's to know about; the rest
/// are ours.
fn read_error(error: anyhow::Error) -> DocumentError {
    if error.downcast_ref::<DesignError>().is_some()
        || error.downcast_ref::<PhotoshopError>().is_some()
        || error.downcast_ref::<IllustratorError>().is_some()
    {
        return DocumentError::BadRequest(error.to_string());
    }
    DocumentError::Internal(error)
}

/// Read a Figma (.fig) design as text with the caller's view access: its
/// pages, each page's top-level frames and sections with their text, the
/// components their instances use, and the file's components, styles and
/// variables.
#[utoipa::path(
    get,
    tag = "document",
    path = "/documents/{document_id}/design",
    operation_id = "read_design",
    params(
        ("document_id" = String, Path, description = "Document identity"),
        DesignReadQuery
    ),
    responses(
        (status = 200, body = DesignFileDescription),
        (status = 400, description = "Not a readable Figma design, or too large", body = model_error_response::ErrorResponse),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Document access denied"),
        (status = 404, description = "Document not found"),
        (status = 500, body = model_error_response::ErrorResponse)
    )
)]
#[tracing::instrument(skip_all, fields(document_id = %document.document_id, pages = query.pages.len()), err)]
pub async fn read_design_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<ViewAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    // Request-local metadata from validate_document_exists_middleware, not a shared service.
    // ast-grep-ignore: rust-no-axum-extension-param
    Extension(document): Extension<DocumentBasic>,
    Query(query): Query<DesignReadQuery>,
) -> Result<Json<DesignFileDescription>, DocumentError> {
    ensure_file_type(&document, &[FileType::Fig], "a Figma (.fig) design")?;
    let pages: Option<Vec<usize>> =
        (!query.pages.is_empty()).then(|| query.pages.iter().map(|&page| page as usize).collect());
    let content = state
        .designs
        .read(access.entity_access_receipt, pages.as_deref())
        .await
        .map_err(read_error)?;
    Ok(Json(DesignFileDescription { content }))
}

/// Read a Photoshop (.psd or .psb) document as text with the caller's view
/// access: its canvas, its layer tree from top to bottom with each layer's
/// settings, and the text of its text layers.
#[utoipa::path(
    get,
    tag = "document",
    path = "/documents/{document_id}/photoshop",
    operation_id = "read_photoshop_document",
    params(("document_id" = String, Path, description = "Document identity")),
    responses(
        (status = 200, body = DesignFileDescription),
        (status = 400, description = "Not a readable Photoshop document, or too large", body = model_error_response::ErrorResponse),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Document access denied"),
        (status = 404, description = "Document not found"),
        (status = 500, body = model_error_response::ErrorResponse)
    )
)]
#[tracing::instrument(skip_all, fields(document_id = %document.document_id), err)]
pub async fn read_photoshop_document_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<ViewAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    // Request-local metadata from validate_document_exists_middleware, not a shared service.
    // ast-grep-ignore: rust-no-axum-extension-param
    Extension(document): Extension<DocumentBasic>,
) -> Result<Json<DesignFileDescription>, DocumentError> {
    ensure_file_type(
        &document,
        &[FileType::Psd, FileType::Psb],
        "a Photoshop (.psd or .psb) document",
    )?;
    let content = state
        .photoshop_documents
        .read(access.entity_access_receipt)
        .await
        .map_err(read_error)?;
    Ok(Json(DesignFileDescription { content }))
}

/// Read an Illustrator (.ai) document as text with the caller's view access:
/// its artboards, its layer tree from top to bottom, and the text of its
/// text objects.
#[utoipa::path(
    get,
    tag = "document",
    path = "/documents/{document_id}/illustrator",
    operation_id = "read_illustrator_document",
    params(("document_id" = String, Path, description = "Document identity")),
    responses(
        (status = 200, body = DesignFileDescription),
        (status = 400, description = "Not a readable Illustrator document, or too large", body = model_error_response::ErrorResponse),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Document access denied"),
        (status = 404, description = "Document not found"),
        (status = 500, body = model_error_response::ErrorResponse)
    )
)]
#[tracing::instrument(skip_all, fields(document_id = %document.document_id), err)]
pub async fn read_illustrator_document_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<ViewAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    // Request-local metadata from validate_document_exists_middleware, not a shared service.
    // ast-grep-ignore: rust-no-axum-extension-param
    Extension(document): Extension<DocumentBasic>,
) -> Result<Json<DesignFileDescription>, DocumentError> {
    ensure_file_type(&document, &[FileType::Ai], "an Illustrator (.ai) document")?;
    let content = state
        .illustrator_documents
        .read(access.entity_access_receipt)
        .await
        .map_err(read_error)?;
    Ok(Json(DesignFileDescription { content }))
}
