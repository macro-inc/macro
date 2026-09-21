//! Authenticated privacy endpoints. Domain service owns role and entitlement checks.

use crate::domain::{
    PrivacyError, PrivacyRepository, PrivacyService, PrivacyStatus, SetPrivacyRequest,
};
use axum::{
    Json, Router,
    extract::{FromRef, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use std::sync::Arc;

/// Router composition state.
pub struct PrivacyRouterState<R, A> {
    /// Domain service.
    pub service: Arc<PrivacyService<R>>,
    /// Authentication service.
    pub authorization_state: MacroAuthorizationState<A>,
}
impl<R, A> Clone for PrivacyRouterState<R, A> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}
impl<R, A> FromRef<PrivacyRouterState<R, A>> for MacroAuthorizationState<A> {
    fn from_ref(s: &PrivacyRouterState<R, A>) -> Self {
        s.authorization_state.clone()
    }
}
/// GET/PATCH the current workspace's privacy status; do not cache this response.
pub fn router<R: PrivacyRepository, A: MacroAuthorizationService, S: Send + Sync + 'static>(
    state: PrivacyRouterState<R, A>,
) -> Router<S> {
    Router::new()
        .route("/", get(status::<R, A>).patch(set::<R, A>))
        .with_state(state)
}
/// Read the authenticated user's current workspace privacy policy.
#[utoipa::path(get, path = "/privacy", operation_id = "get_workspace_privacy",
    responses((status = 200, body = PrivacyStatus), (status = 401, description = "Authentication required"), (status = 503, description = "Policy unavailable")), tag = "auth service")]
pub async fn status<R: PrivacyRepository, A: MacroAuthorizationService>(
    State(s): State<PrivacyRouterState<R, A>>,
    auth: MacroAuthorizationExtractor<A, UserOnly>,
) -> Result<Response, PrivacyError> {
    Ok(response(
        s.service
            .status(auth.authorization.macro_user_id.as_ref())
            .await?,
    ))
}
/// Change safeguards for the authenticated admin's current workspace.
#[utoipa::path(patch, path = "/privacy", operation_id = "set_workspace_privacy", request_body = SetPrivacyRequest,
    responses((status = 200, body = PrivacyStatus), (status = 401, description = "Authentication required"),
        (status = 402, description = "Paid workspace required"), (status = 403, description = "Admin required"),
        (status = 409, description = "Stale revision"), (status = 412, description = "Readiness review required"),
        (status = 503, description = "Policy unavailable")), tag = "auth service")]
pub async fn set<R: PrivacyRepository, A: MacroAuthorizationService>(
    State(s): State<PrivacyRouterState<R, A>>,
    auth: MacroAuthorizationExtractor<A, UserOnly>,
    Json(req): Json<SetPrivacyRequest>,
) -> Result<Response, PrivacyError> {
    Ok(response(
        s.service
            .set(auth.authorization.macro_user_id.as_ref(), &req)
            .await?,
    ))
}
fn response(status: PrivacyStatus) -> Response {
    ([(header::CACHE_CONTROL, "no-store")], Json(status)).into_response()
}
impl IntoResponse for PrivacyError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::Forbidden => StatusCode::FORBIDDEN,
            Self::PaymentRequired => StatusCode::PAYMENT_REQUIRED,
            Self::NotReady => StatusCode::PRECONDITION_FAILED,
            Self::Conflict => StatusCode::CONFLICT,
            Self::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
        };
        (
            status,
            [(header::CACHE_CONTROL, "no-store")],
            self.to_string(),
        )
            .into_response()
    }
}
