//! Handler for `GET /documents/{document_id}/cached_snapshot`.

use axum::{
    body::Body,
    extract::{Path, State},
    http::{Response, StatusCode},
    response::IntoResponse,
};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::DocumentAccessExtractor;
use models_permissions::share_permission::access_level::ViewAccessLevel;

use super::{DocumentRouterState, Params};
use crate::domain::ports::DocumentService;

/// Proxies the cached Loro snapshot bytes, or 404 if none exists.
#[tracing::instrument(skip(state, _access))]
pub async fn get_cached_snapshot_url_handler<T: DocumentService, Svc: EntityAccessService>(
    _access: DocumentAccessExtractor<ViewAccessLevel, Svc>,
    State(state): State<DocumentRouterState<T, Svc>>,
    Path(Params { document_id }): Path<Params>,
) -> impl IntoResponse {
    match state.service.get_snapshot(&document_id).await {
        Ok(Some(bytes)) => Response::builder()
            .status(StatusCode::OK)
            .header("Content-Type", "application/octet-stream")
            .body(Body::from(bytes))
            .unwrap()
            .into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!(error=?e, document_id=document_id, "failed to get snapshot");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}
