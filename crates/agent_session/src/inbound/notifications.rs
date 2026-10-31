//! Internal-only notification production. Identity and payload extraction stay
//! here; validation, deduplication and persistence belong to the domain service.
use super::axum_router::AgentSessionApiError;
use crate::domain::notifications::{NotificationService, ProduceNotification};
use axum::{
    Json, Router,
    extract::{FromRef, State},
    http::StatusCode,
    routing::post,
};
use macro_authorization::{
    InternalOnly, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
};
use std::sync::Arc;

/// Authorization and the independent producer service.
pub struct NotificationRouterState<Auth> {
    /// Internal credential verifier.
    pub authorization: MacroAuthorizationState<Auth>,
    /// Owning-domain use case.
    pub service: Arc<NotificationService>,
}
impl<Auth> Clone for NotificationRouterState<Auth> {
    fn clone(&self) -> Self {
        Self {
            authorization: self.authorization.clone(),
            service: self.service.clone(),
        }
    }
}
impl<Auth> FromRef<NotificationRouterState<Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &NotificationRouterState<Auth>) -> Self {
        state.authorization.clone()
    }
}
/// Mount the trusted producer endpoint independently of public session control.
pub fn notification_router<Auth: MacroAuthorizationService>(
    state: NotificationRouterState<Auth>,
) -> Router {
    Router::new()
        .route("/internal/notifications", post(produce::<Auth>))
        .with_state(state)
}
async fn produce<Auth: MacroAuthorizationService>(
    _: MacroAuthorizationExtractor<Auth, InternalOnly>,
    State(state): State<NotificationRouterState<Auth>>,
    Json(input): Json<ProduceNotification>,
) -> Result<StatusCode, AgentSessionApiError> {
    state.service.produce(input).await?;
    Ok(StatusCode::ACCEPTED)
}
