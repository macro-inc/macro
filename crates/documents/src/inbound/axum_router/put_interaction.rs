//! Handler for `PUT /documents/{document_id}/interaction`.

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor, MacroAuthorizationService};
use serde::Deserialize;

use super::{DocumentRouterState, Params};
use crate::domain::events::InteractionReason;
use crate::domain::ports::DocumentService;

/// Request body for an interaction report from sync-service.
#[derive(Deserialize)]
pub struct InteractionRequest {
    reason: InteractionReason,
}

/// Records a document interaction event.
#[tracing::instrument(skip(state, body, _internal_authorization))]
pub async fn put_interaction_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    _internal_authorization: MacroAuthorizationExtractor<Auth, InternalOnly>,
    Path(Params { document_id }): Path<Params>,
    Json(body): Json<InteractionRequest>,
) -> impl IntoResponse {
    match state
        .service
        .record_interaction(&document_id, body.reason)
        .await
    {
        Ok(()) => StatusCode::OK.into_response(),
        Err(e) => {
            tracing::error!(error=?e, document_id=document_id, "failed to record interaction");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}
