//! Authenticated document text; native Markdown reads collaborative storage.
use super::DocumentRouterState;
use crate::domain::{
    models::DocumentError,
    ports::DocumentService,
    text::{DocumentTextContent, read_text},
};
use axum::{Extension, Json, extract::State};
use entity_access::{
    domain::{models::ViewAccessLevel, ports::EntityAccessService},
    inbound::axum_extractors::DocumentAccessExtractor,
};
use macro_authorization::MacroAuthorizationService;
use model::document::DocumentBasic;

/// Read current Markdown or extracted file text with the document's view receipt.
#[utoipa::path(
    get,
    tag = "document",
    path = "/documents/{document_id}/text-content",
    operation_id = "get_document_text_content",
    params(("document_id" = String, Path, description = "Document identity")),
    responses(
        (status = 200, body = DocumentTextContent),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Document access denied"),
        (status = 404, description = "Document not found"),
        (status = 500, description = "Document text unavailable")
    )
)]
pub async fn get_text_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<ViewAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    // Request-local metadata from validate_document_exists_middleware, not a shared service.
    // ast-grep-ignore: rust-no-axum-extension-param
    Extension(document): Extension<DocumentBasic>,
) -> Result<Json<DocumentTextContent>, DocumentError> {
    read_text(
        state.service.as_ref(),
        state.lexical_client.as_ref(),
        access.entity_access_receipt,
        &document,
    )
    .await
    .map(Json)
}
