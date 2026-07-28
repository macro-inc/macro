//! Admin-only HTTP API for querying AI cost and re-pricing models.
//!
//! Every route is restricted to Macro admins — callers whose user id resolves
//! to an `@macro.com` email.

use crate::domain::{AiFeature, UsageApiParams, UsageService, UsageSummary};
use axum::{
    Json, Router,
    extract::{FromRef, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use chrono::{DateTime, Utc};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::ToSchema;

/// Domain suffix that identifies a Macro admin.
const ADMIN_EMAIL_SUFFIX: &str = "@macro.com";

/// Request body for [`get_usage_handler`].
#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct UsageRequest {
    /// Inclusive lower bound on `created_at`.
    pub from: Option<DateTime<Utc>>,
    /// Exclusive upper bound on `created_at`.
    pub until: Option<DateTime<Utc>>,
    /// If empty, include all users.
    #[serde(default)]
    pub include_users: Vec<String>,
    /// If empty, include all features.
    #[serde(default)]
    pub features: Vec<AiFeature>,
}

/// Request body for [`set_pricing_handler`].
#[derive(Debug, Deserialize, ToSchema)]
pub struct SetPricingRequest {
    /// The model api id to (re)price.
    pub model: String,
    /// New price per million input tokens (USD).
    pub price_per_mil_in: f32,
    /// New price per million output tokens (USD).
    pub price_per_mil_out: f32,
}

/// Error response body.
#[derive(Serialize, ToSchema)]
pub struct ErrorBody {
    /// Human-readable error description.
    pub error: String,
}

/// Router state containing the usage service and the authorization state used
/// to authenticate callers.
pub struct AiUsageRouterState<T, Auth> {
    /// The usage service implementation.
    pub service: Arc<T>,
    /// The authorization state used by the request extractors.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

// Manual Clone impl so T doesn't need to be Clone (it's behind Arc).
impl<T, Auth> Clone for AiUsageRouterState<T, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<T, Auth> FromRef<AiUsageRouterState<T, Auth>> for Arc<T> {
    fn from_ref(state: &AiUsageRouterState<T, Auth>) -> Self {
        state.service.clone()
    }
}

impl<T, Auth> FromRef<AiUsageRouterState<T, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &AiUsageRouterState<T, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the admin AI-cost router.
pub fn ai_usage_router<T, Auth, S>(state: AiUsageRouterState<T, Auth>) -> Router<S>
where
    T: UsageService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + Clone + 'static,
{
    Router::new()
        .route("/ai-cost/usage", post(get_usage_handler::<T, Auth>))
        .route("/ai-cost/pricing", post(set_pricing_handler::<T, Auth>))
        .with_state(state)
}

/// Returns `Some(403)` unless the caller is a Macro admin.
fn admin_rejection<Auth>(
    user: &MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Option<Response> {
    if user
        .authorization
        .user
        .macro_user_id
        .email_str()
        .ends_with(ADMIN_EMAIL_SUFFIX)
    {
        None
    } else {
        Some(
            (
                StatusCode::FORBIDDEN,
                Json(ErrorBody {
                    error: "admin access required".to_string(),
                }),
            )
                .into_response(),
        )
    }
}

fn internal_error(context: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorBody {
            error: context.to_string(),
        }),
    )
        .into_response()
}

/// Query recorded AI usage. Admin only.
#[utoipa::path(
    post,
    path = "/ai-cost/usage",
    request_body = UsageRequest,
    responses(
        (status = 200, description = "Usage summary", body = UsageSummary),
        (status = 400, description = "Invalid request", body = ErrorBody),
        (status = 403, description = "Admin access required", body = ErrorBody),
        (status = 500, description = "Internal server error", body = ErrorBody),
    ),
    tag = "ai_usage"
)]
#[tracing::instrument(
    skip(service, user),
    fields(actor = %user.acting_entity())
)]
pub async fn get_usage_handler<T: UsageService, Auth: MacroAuthorizationService>(
    State(service): State<Arc<T>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(req): Json<UsageRequest>,
) -> Response {
    if let Some(resp) = admin_rejection(&user) {
        return resp;
    }

    let include_users: std::result::Result<Vec<MacroUserIdStr<'static>>, _> = req
        .include_users
        .into_iter()
        .map(MacroUserIdStr::try_from)
        .collect();
    let include_users = match include_users {
        Ok(u) => u,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ErrorBody {
                    error: format!("invalid user id: {e}"),
                }),
            )
                .into_response();
        }
    };

    let params = UsageApiParams {
        from: req.from,
        until: req.until,
        include_users,
        features: req.features,
    };

    match service.get_usage(params).await {
        Ok(summary) => Json(summary).into_response(),
        Err(e) => {
            tracing::error!(error = ?e, "failed to query ai usage");
            internal_error("failed to query usage")
        }
    }
}

/// Set the pricing for a model and recompute its recorded rows. Admin only.
#[utoipa::path(
    post,
    path = "/ai-cost/pricing",
    request_body = SetPricingRequest,
    responses(
        (status = 200, description = "Pricing updated"),
        (status = 403, description = "Admin access required", body = ErrorBody),
        (status = 500, description = "Internal server error", body = ErrorBody),
    ),
    tag = "ai_usage"
)]
#[tracing::instrument(
    skip(service, user),
    fields(actor = %user.acting_entity())
)]
pub async fn set_pricing_handler<T: UsageService, Auth: MacroAuthorizationService>(
    State(service): State<Arc<T>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(req): Json<SetPricingRequest>,
) -> Response {
    if let Some(resp) = admin_rejection(&user) {
        return resp;
    }

    match service
        .set_pricing(req.model, req.price_per_mil_in, req.price_per_mil_out)
        .await
    {
        Ok(()) => StatusCode::OK.into_response(),
        Err(e) => {
            tracing::error!(error = ?e, "failed to set pricing");
            internal_error("failed to set pricing")
        }
    }
}
