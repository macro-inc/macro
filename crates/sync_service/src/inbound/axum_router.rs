use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};

use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
};

use crate::domain::{
    models::{BulkWakeupRequest, BulkWakeupResponse},
    ports::SyncWakeupService,
};

pub struct SyncServiceRouterState<Svc, Auth> {
    pub service: Arc<Svc>,
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<Svc, Auth> Clone for SyncServiceRouterState<Svc, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Svc, Auth> FromRef<SyncServiceRouterState<Svc, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &SyncServiceRouterState<Svc, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

pub fn sync_service_router<Svc, Auth, S>(state: SyncServiceRouterState<Svc, Auth>) -> Router<S>
where
    Svc: SyncWakeupService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    Router::new()
        .route("/wakeup", post(bulk_wakeup_handler::<Svc, Auth>))
        .with_state(state)
}

#[utoipa::path(
    tag = "sync_service",
    post,
    path = "/sync_service/wakeup",
    operation_id = "bulk_wakeup_sync_service_documents",
    request_body = BulkWakeupRequest,
    responses(
        (status = 202, description = "Wakeups accepted for fire-and-forget dispatch", body = BulkWakeupResponse),
        (status = 401, description = "Authentication required (JSON error response)"),
    )
)]
pub async fn bulk_wakeup_handler<Svc, Auth>(
    State(state): State<SyncServiceRouterState<Svc, Auth>>,
    _user: MacroAuthorizationExtractor<Auth>,
    Json(request): Json<BulkWakeupRequest>,
) -> Response
where
    Svc: SyncWakeupService,
    Auth: MacroAuthorizationService,
{
    let dispatched = state.service.bulk_wakeup(request.document_ids);

    (
        StatusCode::ACCEPTED,
        Json(BulkWakeupResponse { dispatched }),
    )
        .into_response()
}
