use std::sync::Arc;

use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};

use crate::domain::{
    models::{BulkWakeupRequest, BulkWakeupResponse},
    ports::SyncWakeupService,
};

pub struct SyncServiceRouterState<Svc> {
    pub service: Arc<Svc>,
}

impl<Svc> Clone for SyncServiceRouterState<Svc> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
        }
    }
}

pub fn sync_service_router<Svc, S>(state: SyncServiceRouterState<Svc>) -> Router<S>
where
    Svc: SyncWakeupService,
    S: Send + Sync + 'static,
{
    Router::new()
        .route("/wakeup", post(bulk_wakeup_handler::<Svc>))
        .with_state(state)
}

pub async fn bulk_wakeup_handler<Svc>(
    State(state): State<SyncServiceRouterState<Svc>>,
    Json(request): Json<BulkWakeupRequest>,
) -> Response
where
    Svc: SyncWakeupService,
{
    let dispatched = state.service.bulk_wakeup(request.document_ids);

    (
        StatusCode::ACCEPTED,
        Json(BulkWakeupResponse { dispatched }),
    )
        .into_response()
}
