//! Admin-only HTTP API for querying AI cost and re-pricing models.
//!
//! Every route is restricted to Macro admins — callers whose user id resolves
//! to an `@macro.com` email.

use super::models::UsageSummary;
use crate::domain::{AiFeature, ModelPricing, UsageApiParams, UsageError, UsageService};
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
    /// New price per million input tokens (USD). Required for token pricing.
    pub price_per_mil_in: Option<f32>,
    /// New price per million output tokens (USD). Required for token pricing.
    pub price_per_mil_out: Option<f32>,
    /// Price per minute of audio (USD), or null for token-only pricing.
    pub price_per_audio_minute: Option<f32>,
}

impl SetPricingRequest {
    fn pricing(&self) -> Result<ModelPricing, &'static str> {
        match (
            self.price_per_mil_in,
            self.price_per_mil_out,
            self.price_per_audio_minute,
        ) {
            (input, output, Some(per_minute))
                if input.is_none_or(|price| price == 0.0)
                    && output.is_none_or(|price| price == 0.0) =>
            {
                Ok(ModelPricing::Audio { per_minute })
            }
            (Some(input), Some(output), None) => Ok(ModelPricing::Tokens { input, output }),
            (_, _, Some(_)) => Err("choose token pricing or audio pricing"),
            _ => Err("provide both token prices or an audio price"),
        }
    }
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

fn error_response(error: UsageError, context: &str) -> Response {
    let (status, message) = match error {
        UsageError::Forbidden => (StatusCode::FORBIDDEN, "admin access required"),
        UsageError::InvalidPricing => (
            StatusCode::BAD_REQUEST,
            "prices must be finite and non-negative",
        ),
        error => {
            tracing::error!(error = ?error, context, "AI usage request failed");
            (StatusCode::INTERNAL_SERVER_ERROR, context)
        }
    };
    (
        status,
        Json(ErrorBody {
            error: message.to_string(),
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

    match service
        .get_usage(user.authorization.user.macro_user_id, params)
        .await
    {
        Ok(summary) => Json(UsageSummary::from(summary)).into_response(),
        Err(error) => error_response(error, "failed to query usage"),
    }
}

/// Set the pricing for a model and recompute its recorded rows. Admin only.
#[utoipa::path(
    post,
    path = "/ai-cost/pricing",
    request_body = SetPricingRequest,
    responses(
        (status = 200, description = "Pricing updated"),
        (status = 400, description = "Invalid pricing", body = ErrorBody),
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
    let pricing = match req.pricing() {
        Ok(pricing) => pricing,
        Err(error) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ErrorBody {
                    error: error.into(),
                }),
            )
                .into_response();
        }
    };
    match service
        .set_pricing(user.authorization.user.macro_user_id, req.model, pricing)
        .await
    {
        Ok(()) => StatusCode::OK.into_response(),
        Err(error) => error_response(error, "failed to set pricing"),
    }
}

#[cfg(test)]
mod test;
