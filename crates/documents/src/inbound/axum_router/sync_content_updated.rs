//! Handler for sync-content notifications from the synchronization service.

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor, MacroAuthorizationService};
use serde::Deserialize;

use super::{DocumentRouterState, Params};
use crate::domain::{models::DocumentError, ports::DocumentContentEventService};

/// Attribution from the sync service's verified document token.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SyncContentUpdatedRequest {
    /// Actor that performed the edit, if any.
    pub actor: Option<String>,
    /// User represented by the actor, if any.
    pub on_behalf_of: Option<String>,
}

/// Publish an event using the document's stored metadata.
#[tracing::instrument(err, skip(state, _internal_authorization))]
pub async fn sync_content_updated_handler<
    T: DocumentContentEventService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    _internal_authorization: MacroAuthorizationExtractor<Auth, InternalOnly>,
    Path(Params { document_id }): Path<Params>,
    Json(request): Json<SyncContentUpdatedRequest>,
) -> Result<StatusCode, DocumentError> {
    state
        .service
        .publish_sync_content_updated(&document_id, request.actor, request.on_behalf_of)
        .await?;
    Ok(StatusCode::OK)
}
