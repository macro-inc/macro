//! Handler for `PUT /documents/{document_id}/snapshot`.

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use entity_access::domain::ports::EntityAccessService;

use super::{DocumentRouterState, Params};
use crate::domain::ports::DocumentService;

/// Accepts raw snapshot bytes and stores them in S3.
#[tracing::instrument(skip(state, body))]
pub async fn put_snapshot_handler<T: DocumentService, Svc: EntityAccessService>(
    State(state): State<DocumentRouterState<T, Svc>>,
    Path(Params { document_id }): Path<Params>,
    body: Bytes,
) -> impl IntoResponse {
    match state
        .service
        .upload_snapshot(&document_id, body.to_vec())
        .await
    {
        Ok(()) => StatusCode::OK.into_response(),
        Err(e) => {
            tracing::error!(error=?e, document_id=document_id, "failed to upload snapshot");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}
