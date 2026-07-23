//! HTTP surface for the onboarding flow.

use crate::domain::models::{OnboardingRow, OnboardingState};
use crate::domain::ports::OnboardingError;
use crate::domain::service::OnboardingService;
use axum::{
    Json, Router,
    extract::{FromRef, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use serde::Deserialize;
use std::sync::Arc;
use utoipa::ToSchema;

/// Body for completing onboarding.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CompleteOnboardingRequest {
    /// Whether the user skipped rather than finished.
    #[serde(default)]
    pub skipped: bool,
}

/// Router state: the onboarding service plus the authorization state the
/// request extractors authenticate against (auth happens in the extractor,
/// not in host-layered middleware).
pub struct OnboardingRouterState<T, Auth> {
    /// The onboarding service implementation.
    pub service: Arc<T>,
    /// The authorization state used by the request extractors.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

// Manual Clone impl so T doesn't need to be Clone (it's behind Arc).
impl<T, Auth> Clone for OnboardingRouterState<T, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<T, Auth> FromRef<OnboardingRouterState<T, Auth>> for Arc<T> {
    fn from_ref(state: &OnboardingRouterState<T, Auth>) -> Self {
        state.service.clone()
    }
}

impl<T, Auth> FromRef<OnboardingRouterState<T, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &OnboardingRouterState<T, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the onboarding router.
pub fn onboarding_router<T, Auth, S>(state: OnboardingRouterState<T, Auth>) -> Router<S>
where
    T: OnboardingService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + Clone + 'static,
{
    Router::new()
        .route("/onboarding", get(get_state_handler::<T, Auth>))
        .route("/onboarding/complete", post(complete_handler::<T, Auth>))
        .with_state(state)
}

fn error_response(e: OnboardingError) -> Response {
    tracing::error!(error = ?e, "onboarding request failed");
    StatusCode::INTERNAL_SERVER_ERROR.into_response()
}

/// Get the authenticated user's onboarding state. While the flow is active
/// this also starts any gather runs that are due, so polling this endpoint
/// is what keeps onboarding moving.
#[utoipa::path(
    get,
    path = "/onboarding",
    responses(
        (status = 200, description = "Current onboarding state", body = OnboardingState),
        (status = 500, description = "Internal server error"),
    ),
    tag = "onboarding"
)]
#[tracing::instrument(skip(service, user), fields(user_id = %user.authorization.user.macro_user_id))]
pub async fn get_state_handler<T: OnboardingService, Auth: MacroAuthorizationService>(
    State(service): State<Arc<T>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Response {
    match service
        .get_state(user.authorization.user.macro_user_id)
        .await
    {
        Ok(state) => Json(state).into_response(),
        Err(e) => error_response(e),
    }
}

/// Complete (or skip) onboarding. Unreserved leftover onboarding-staged
/// import candidates are deleted.
#[utoipa::path(
    post,
    path = "/onboarding/complete",
    request_body = CompleteOnboardingRequest,
    responses(
        (status = 200, description = "Completed onboarding row", body = OnboardingRow),
        (status = 500, description = "Internal server error"),
    ),
    tag = "onboarding"
)]
#[tracing::instrument(skip(service, user, body), fields(user_id = %user.authorization.user.macro_user_id))]
pub async fn complete_handler<T: OnboardingService, Auth: MacroAuthorizationService>(
    State(service): State<Arc<T>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(body): Json<CompleteOnboardingRequest>,
) -> Response {
    match service
        .complete(user.authorization.user.macro_user_id, body.skipped)
        .await
    {
        Ok(row) => Json(row).into_response(),
        Err(e) => error_response(e),
    }
}
