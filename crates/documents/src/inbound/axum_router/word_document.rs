//! Word routes: read an uploaded DOCX's live copy with its paragraph ids and
//! apply an atomic batch of edits to it, through the same Word document
//! service and access checks as the ReadWordDocument and EditWordDocument
//! tools. Edits land in the live copy, so open editors see them at once.

use super::DocumentRouterState;
use crate::domain::{
    models::DocumentError,
    ports::DocumentService,
    word_document::{
        WordDocumentOperation, WordDocumentRejected, WordDocumentResponse, WordEditOptions,
    },
};
use axum::{
    Json,
    extract::{Query, State, rejection::JsonRejection},
};
use entity_access::{
    domain::{
        models::{EditAccessLevel, EntityAccessAuth, EntityAccessReceipt, ViewAccessLevel},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::DocumentAccessExtractor,
};
use macro_authorization::MacroAuthorizationService;
use macro_user_id::user_id::MacroUserIdStr;

/// Which blocks to read.
#[derive(Debug, serde::Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct WordDocumentReadQuery {
    /// First block to show, 1-based; omit to start at the beginning.
    pub start: Option<u32>,
    /// Most blocks to show; omit for as many as fit.
    pub count: Option<u32>,
}

/// An atomic batch of edits to a Word document.
#[derive(Debug, serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WordDocumentEditRequest {
    /// Operations applied together, in order: 1 to 50.
    pub operations: Vec<WordDocumentOperation>,
    /// Record the edits as tracked changes (true) or apply them directly
    /// (false); omit to follow the document's own Track Changes setting.
    #[serde(default)]
    pub track_changes: Option<bool>,
    /// Name tracked changes and comments are attributed to; omit for the
    /// requesting user's name.
    #[serde(default)]
    pub author: Option<String>,
}

/// The user the edit is made for and the bot making it, if a bot calls.
fn caller<Level: entity_access::domain::models::RequiredPermission>(
    receipt: &EntityAccessReceipt<Level>,
) -> Result<(MacroUserIdStr<'static>, Option<String>), DocumentError> {
    let user = receipt
        .acting_user_id()
        .cloned()
        .ok_or(DocumentError::Unauthorized)?;
    let actor = match receipt.auth() {
        EntityAccessAuth::Bot(bot) => Some(bot.bot_id().into_storage_id().to_string()),
        EntityAccessAuth::Authenticated(_)
        | EntityAccessAuth::Unauthenticated
        | EntityAccessAuth::Internal => None,
    };
    Ok((user, actor))
}

/// Requests the editor refused are the caller's to fix; the rest are ours.
fn word_document_error(error: anyhow::Error) -> DocumentError {
    match error.downcast_ref::<WordDocumentRejected>() {
        Some(rejected) => DocumentError::BadRequest(rejected.to_string()),
        None => DocumentError::Internal(error),
    }
}

/// Read an uploaded Word document as it stands now, including edits made in
/// Macro, with the caller's view access: every paragraph, table cell and
/// content control with its stable id, style and text, tracked changes, and
/// Word comments. Long documents are paged.
#[utoipa::path(
    get,
    tag = "document",
    path = "/documents/{document_id}/word",
    operation_id = "read_word_document",
    params(
        ("document_id" = String, Path, description = "Document identity"),
        WordDocumentReadQuery
    ),
    responses(
        (status = 200, body = WordDocumentResponse),
        (status = 400, description = "Not an uploaded Word document, or still being processed after upload", body = model_error_response::ErrorResponse),
        (status = 401, description = "Authentication required, or a bot with no acting user"),
        (status = 403, description = "Document access denied"),
        (status = 404, description = "Document not found"),
        (status = 500, body = model_error_response::ErrorResponse)
    )
)]
#[tracing::instrument(skip_all, fields(document_id = %access.entity_access_receipt.entity().entity_id), err)]
pub async fn read_word_document_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<ViewAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    Query(query): Query<WordDocumentReadQuery>,
) -> Result<Json<WordDocumentResponse>, DocumentError> {
    let (user, actor) = caller(&access.entity_access_receipt)?;
    state
        .word_documents
        .read(
            access.entity_access_receipt,
            &user,
            actor.as_deref(),
            query.start,
            query.count,
        )
        .await
        .map(Json)
        .map_err(word_document_error)
}

/// Apply a batch of edits to an uploaded Word document's live copy
/// atomically with the caller's edit access. Nothing changes if any
/// operation fails. Returns the changed blocks as they now read.
#[utoipa::path(
    post,
    tag = "document",
    path = "/documents/{document_id}/word/edits",
    operation_id = "edit_word_document",
    params(("document_id" = String, Path, description = "Document identity")),
    request_body = WordDocumentEditRequest,
    responses(
        (status = 200, body = WordDocumentResponse),
        (status = 400, description = "Not an uploaded Word document, a batch outside 1 to 50 operations, an invalid author, or operations the editor refused; nothing changed", body = model_error_response::ErrorResponse),
        (status = 401, description = "Authentication required, or a bot with no acting user"),
        (status = 403, description = "Document edit access denied"),
        (status = 404, description = "Document not found"),
        (status = 500, body = model_error_response::ErrorResponse)
    )
)]
#[tracing::instrument(
    skip_all,
    fields(document_id = %access.entity_access_receipt.entity().entity_id, operations = tracing::field::Empty),
    err
)]
pub async fn edit_word_document_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<EditAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    body: Result<Json<WordDocumentEditRequest>, JsonRejection>,
) -> Result<Json<WordDocumentResponse>, DocumentError> {
    let Json(request) =
        body.map_err(|rejection| DocumentError::BadRequest(rejection.body_text()))?;
    tracing::Span::current().record("operations", request.operations.len());
    let (user, actor) = caller(&access.entity_access_receipt)?;
    state
        .word_documents
        .edit(
            access.entity_access_receipt,
            &user,
            actor.as_deref(),
            request.operations,
            WordEditOptions {
                track_changes: request.track_changes,
                author: request.author,
            },
        )
        .await
        .map(Json)
        .map_err(word_document_error)
}
