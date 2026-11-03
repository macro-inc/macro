//! A markdown document's XML structure, for programs that edit it by node id.
use super::DocumentRouterState;
use crate::domain::{
    document_edits::{DocumentStructure, read_structure},
    models::DocumentError,
    ports::DocumentService,
};
use axum::{Extension, Json, extract::State};
use entity_access::{
    domain::{models::ViewAccessLevel, ports::EntityAccessService},
    inbound::axum_extractors::DocumentAccessExtractor,
};
use macro_authorization::MacroAuthorizationService;
use model::document::DocumentBasic;

/// Read a markdown document or task as XML with durable node ids, the view
/// `POST /documents/{document_id}/edits` addresses.
#[utoipa::path(
    get,
    tag = "document",
    path = "/documents/{document_id}/structure",
    operation_id = "get_document_structure",
    params(("document_id" = String, Path, description = "Document identity")),
    responses(
        (status = 200, body = DocumentStructure),
        (status = 400, description = "Not a markdown document", body = model_error_response::ErrorResponse),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Document access denied"),
        (status = 404, description = "Document not found"),
        (status = 500, description = "Document structure unavailable", body = model_error_response::ErrorResponse)
    )
)]
pub async fn get_structure_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<ViewAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    // Request-local metadata from validate_document_exists_middleware, not a shared service.
    // ast-grep-ignore: rust-no-axum-extension-param
    Extension(document): Extension<DocumentBasic>,
) -> Result<Json<DocumentStructure>, DocumentError> {
    read_structure(
        state.lexical_client.as_ref(),
        access.entity_access_receipt,
        &document,
    )
    .await
    .map(Json)
}
