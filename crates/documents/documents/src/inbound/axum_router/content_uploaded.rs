//! Handler for `POST /internal/documents/{document_id}/content-uploaded`.

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use document_id::DocumentId;
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor, MacroAuthorizationService};
use serde::Deserialize;
use shared_types::document::FileType;

use super::{DocumentRouterState, Params};
use crate::domain::{models::DocumentError, ports::DocumentContentEventService};

/// Request body describing the uploaded document content.
#[derive(Debug, Deserialize)]
pub struct ContentUploadedRequest {
    /// File type of the uploaded object.
    pub file_type: FileType,
    /// Uploaded version or converted-file marker, when present.
    pub document_version_id: Option<String>,
}

/// Publishes a content-uploaded event for an existing document.
#[tracing::instrument(err, skip(state, _internal_authorization))]
pub async fn content_uploaded_handler<
    T: DocumentContentEventService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    _internal_authorization: MacroAuthorizationExtractor<Auth, InternalOnly>,
    Path(Params { document_id }): Path<Params>,
    Json(request): Json<ContentUploadedRequest>,
) -> Result<StatusCode, DocumentError> {
    state
        .service
        .publish_content_uploaded(
            &DocumentId::parse(&document_id)
                .map_err(|_| DocumentError::NotFound(document_id.clone()))?,
            request.file_type,
            request.document_version_id,
        )
        .await?;

    Ok(StatusCode::OK)
}
