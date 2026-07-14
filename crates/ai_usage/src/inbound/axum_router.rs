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
use macro_authorization::{SharedMacroAuthorizationExtractor, SharedMacroAuthorizationService};
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

/// State for the admin AI-cost router.
pub struct AiUsageRouterState<T> {
    /// The AI usage service implementation.
    pub service: Arc<T>,
    /// The authorization service used to authenticate callers.
    pub auth: SharedMacroAuthorizationService,
}

impl<T> Clone for AiUsageRouterState<T> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            auth: self.auth.clone(),
        }
    }
}

impl<T> FromRef<AiUsageRouterState<T>> for SharedMacroAuthorizationService {
    fn from_ref(state: &AiUsageRouterState<T>) -> Self {
        state.auth.clone()
    }
}

/// Build the admin AI-cost router.
pub fn ai_usage_router<T, S>(state: AiUsageRouterState<T>) -> Router<S>
where
    T: UsageService,
    S: Send + Sync + Clone + 'static,
{
    Router::new()
        .route("/ai-cost/usage", post(get_usage_handler::<T>))
        .route("/ai-cost/pricing", post(set_pricing_handler::<T>))
        .with_state(state)
}

/// Returns `Some(403)` unless the caller is a Macro admin.
fn admin_rejection(user: &SharedMacroAuthorizationExtractor) -> Option<Response> {
    if user.macro_user_id.email_str().ends_with(ADMIN_EMAIL_SUFFIX) {
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
#[tracing::instrument(skip(state, user), fields(user_id = %user.macro_user_id))]
pub async fn get_usage_handler<T: UsageService>(
    State(state): State<AiUsageRouterState<T>>,
    user: SharedMacroAuthorizationExtractor,
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

    match state.service.get_usage(params).await {
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
#[tracing::instrument(skip(state, user), fields(user_id = %user.macro_user_id))]
pub async fn set_pricing_handler<T: UsageService>(
    State(state): State<AiUsageRouterState<T>>,
    user: SharedMacroAuthorizationExtractor,
    Json(req): Json<SetPricingRequest>,
) -> Response {
    if let Some(resp) = admin_rejection(&user) {
        return resp;
    }

    match state
        .service
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
