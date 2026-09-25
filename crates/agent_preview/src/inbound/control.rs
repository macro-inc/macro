use crate::domain::{Launch, Preview, PreviewError, PreviewService};
use axum::{
    Json, Router,
    extract::{FromRef, State},
    http::StatusCode,
    routing::{get, post},
};
use entity_access::{
    domain::{
        models::{EditAccessLevel, ViewAccessLevel},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::AgentSessionAccessLevelExtractor,
};
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use std::sync::Arc;

/// State shared by Macro control routes and the standard authorization extractors.
pub struct ControlState<Access, Auth> {
    service: PreviewService,
    access: Arc<Access>,
    auth: MacroAuthorizationState<Auth>,
}
impl<Access, Auth> ControlState<Access, Auth> {
    /// Compose service and existing Macro authentication/entity-access implementations.
    pub fn new(
        service: PreviewService,
        access: Arc<Access>,
        auth: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service,
            access,
            auth,
        }
    }
}
impl<Access, Auth> Clone for ControlState<Access, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            access: self.access.clone(),
            auth: self.auth.clone(),
        }
    }
}
impl<Access, Auth> FromRef<ControlState<Access, Auth>> for Arc<Access> {
    fn from_ref(state: &ControlState<Access, Auth>) -> Self {
        state.access.clone()
    }
}
impl<Access, Auth> FromRef<ControlState<Access, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &ControlState<Access, Auth>) -> Self {
        state.auth.clone()
    }
}
/// Current session preview, including the absence of a lease after a gateway restart.
#[derive(serde::Serialize)]
pub struct PreviewSnapshot {
    /// Current lease, or no preview.
    pub preview: Option<Preview>,
}

/// Control endpoints; mount under `/preview` on Macro's authenticated API gateway.
pub fn router<Access: EntityAccessService, Auth: MacroAuthorizationService>(
    state: ControlState<Access, Auth>,
) -> Router {
    Router::new()
        .route(
            "/agent-sessions/{session_id}",
            get(read::<Access, Auth>).delete(stop::<Access, Auth>),
        )
        .route(
            "/agent-sessions/{session_id}/open",
            post(open::<Access, Auth>),
        )
        .with_state(state)
}
async fn read<Access: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<ControlState<Access, Auth>>,
    receipt: AgentSessionAccessLevelExtractor<ViewAccessLevel, Access, Auth>,
) -> Result<Json<PreviewSnapshot>, PreviewError> {
    state
        .service
        .get(receipt.entity_access_receipt)
        .map(|preview| Json(PreviewSnapshot { preview }))
}
async fn open<Access: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<ControlState<Access, Auth>>,
    receipt: AgentSessionAccessLevelExtractor<ViewAccessLevel, Access, Auth>,
) -> Result<Json<Launch>, PreviewError> {
    state
        .service
        .launch(receipt.entity_access_receipt)
        .map(Json)
}
async fn stop<Access: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<ControlState<Access, Auth>>,
    receipt: AgentSessionAccessLevelExtractor<EditAccessLevel, Access, Auth>,
) -> Result<StatusCode, PreviewError> {
    state.service.stop(receipt.entity_access_receipt).await?;
    Ok(StatusCode::NO_CONTENT)
}
