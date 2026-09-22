//! Service-only invitation lookup: scheduling facts must come from authorized email reads.
use crate::domain::invitations::{
    CalendarInvitationService, InvitationIdentity, InvitationResolution, MAX_INVITATION_BATCH,
};
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

/// Internal invitation API state; concrete adapters are supplied by the host.
pub struct CalendarInvitationRouterState<S, Auth> {
    service: Arc<S>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> Clone for CalendarInvitationRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Auth> CalendarInvitationRouterState<S, Auth> {
    /// Construct the endpoint with a calendar-domain service and authenticator.
    pub fn new(service: Arc<S>, authorization_state: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service,
            authorization_state,
        }
    }
}

impl<S, Auth> FromRef<CalendarInvitationRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &CalendarInvitationRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Mount the bounded internal endpoint independently of the mutation kill switch.
/// Calendar reads remain useful when responses are disabled.
pub fn calendar_invitation_router<S, Auth, T>(
    state: CalendarInvitationRouterState<S, Auth>,
) -> Router<T>
where
    S: CalendarInvitationService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route("/internal/invitations/resolve", post(resolve::<S, Auth>))
        .with_state(state)
}

async fn resolve<S: CalendarInvitationService, Auth: MacroAuthorizationService>(
    State(state): State<CalendarInvitationRouterState<S, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, InternalOnly>,
    Json(items): Json<Vec<InvitationIdentity>>,
) -> Result<Json<Vec<InvitationResolution>>, StatusCode> {
    let viewer = auth
        .authorization
        .acting_user
        .ok_or(StatusCode::UNAUTHORIZED)?;
    if items.len() > MAX_INVITATION_BATCH {
        return Err(StatusCode::BAD_REQUEST);
    }
    state
        .service
        .resolve(viewer.macro_user_id.as_ref(), &items)
        .await
        .map(Json)
        .map_err(|error| {
            tracing::error!(error=?error, "calendar invitation resolution failed");
            StatusCode::SERVICE_UNAVAILABLE
        })
}
