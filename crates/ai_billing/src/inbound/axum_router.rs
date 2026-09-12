//! HTTP API for AI billing: the payer's position, overage settings, credit
//! purchases, the plan catalog, and the internal settle hook.

use crate::domain::{
    BillingError, BillingService, CREDIT_PACKS_CENTS, OVERAGE_LIMIT_MAX_CENTS,
    OVERAGE_LIMIT_MIN_CENTS, PlanTier, UsageSnapshot,
};
use axum::{
    Json, Router,
    extract::{FromRef, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, patch, post},
};
use macro_authorization::{
    InternalOnly, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
    UserOrInternal,
};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::ToSchema;

/// Error response body.
#[derive(Debug, Serialize, ToSchema)]
pub struct AiBillingErrorBody {
    /// Human-readable error description.
    pub error: String,
}

/// One plan in the catalog.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PlanCatalogEntry {
    /// The tier.
    pub tier: PlanTier,
    /// Monthly list price per seat, cents.
    pub monthly_price_cents: i64,
    /// Included AI per seat per period, list-rate cents.
    pub included_ai_cents_per_seat: i64,
}

/// The plan catalog and the knobs the billing UI offers.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PlanCatalogResponse {
    /// Every plan, cheapest first.
    pub plans: Vec<PlanCatalogEntry>,
    /// Credit packs a payer may buy, cents.
    pub credit_packs_cents: Vec<i64>,
    /// Smallest allowed overage cap, cents.
    pub overage_limit_min_cents: i64,
    /// Largest allowed overage cap, cents.
    pub overage_limit_max_cents: i64,
}

/// Request body for [`update_overage_handler`].
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateOverageRequest {
    /// Bill usage past allowance and credits.
    pub enabled: bool,
    /// Per-period cap on overage spend, cents. Required when enabling.
    #[serde(default)]
    pub limit_cents: i64,
}

/// Request body for [`create_credit_checkout_handler`].
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreditCheckoutRequestBody {
    /// Pack size, cents; one of the catalog's `credit_packs_cents`.
    pub amount_cents: i64,
    /// Where Stripe returns the user after paying.
    pub success_url: String,
    /// Where Stripe returns the user on cancel.
    pub cancel_url: String,
}

/// Response for [`create_credit_checkout_handler`].
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreditCheckoutResponse {
    /// The hosted Checkout URL to redirect to.
    pub url: String,
}

/// Request body for [`settle_handler`].
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SettleRequest {
    /// Any user billed to the payer to settle.
    pub user_id: String,
}

/// Router state: the billing service plus the authorization state the
/// extractors need.
pub struct AiBillingRouterState<B, Auth> {
    /// The billing service.
    pub service: Arc<B>,
    /// Authorization state for the request extractors.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<B, Auth> Clone for AiBillingRouterState<B, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<B, Auth> FromRef<AiBillingRouterState<B, Auth>> for Arc<B> {
    fn from_ref(state: &AiBillingRouterState<B, Auth>) -> Self {
        state.service.clone()
    }
}

impl<B, Auth> FromRef<AiBillingRouterState<B, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &AiBillingRouterState<B, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the AI billing router.
pub fn ai_billing_router<B, Auth, S>(state: AiBillingRouterState<B, Auth>) -> Router<S>
where
    B: BillingService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + Clone + 'static,
{
    Router::new()
        .route("/ai-billing/summary", get(get_summary_handler::<B, Auth>))
        .route("/ai-billing/plans", get(get_plans_handler))
        .route(
            "/ai-billing/overage",
            patch(update_overage_handler::<B, Auth>),
        )
        .route(
            "/ai-billing/credits/checkout",
            post(create_credit_checkout_handler::<B, Auth>),
        )
        .route(
            "/internal/ai-billing/settle",
            post(settle_handler::<B, Auth>),
        )
        .with_state(state)
}

fn error_response(e: BillingError) -> Response {
    let status = match &e {
        BillingError::NotPayer => StatusCode::FORBIDDEN,
        BillingError::FreePlan => StatusCode::PAYMENT_REQUIRED,
        BillingError::InvalidCreditAmount
        | BillingError::InvalidOverageLimit
        | BillingError::NoStripeCustomer => StatusCode::BAD_REQUEST,
        BillingError::Payment(_) | BillingError::Storage(_) | BillingError::Entitlement(_) => {
            tracing::error!(error = ?e, "ai billing request failed");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    };
    let error = if status == StatusCode::INTERNAL_SERVER_ERROR {
        "internal error".to_string()
    } else {
        e.to_string()
    };
    (status, Json(AiBillingErrorBody { error })).into_response()
}

/// The caller's current-period AI usage, credits, and overage settings.
///
/// Runs a settlement first so the position reflects any credits or overage
/// that were waiting to be booked.
#[utoipa::path(
    get,
    path = "/ai-billing/summary",
    operation_id = "get_ai_billing_summary",
    responses(
        (status = 200, description = "Current-period position", body = UsageSnapshot),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error", body = AiBillingErrorBody),
    ),
    tag = "ai_billing"
)]
#[tracing::instrument(skip(service, user), fields(user_id = %user.authorization.user.macro_user_id))]
pub async fn get_summary_handler<B: BillingService, Auth: MacroAuthorizationService>(
    State(service): State<Arc<B>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Response {
    let user_id = &user.authorization.user.macro_user_id;
    if let Err(e) = service.settle(user_id).await {
        // Collection problems show up in the snapshot; don't fail the read.
        tracing::warn!(error = ?e, "settlement before summary failed");
    }
    match service.snapshot(user_id).await {
        Ok(snapshot) => Json(snapshot).into_response(),
        Err(e) => error_response(e),
    }
}

/// The plan catalog, credit packs, and overage cap bounds.
#[utoipa::path(
    get,
    path = "/ai-billing/plans",
    operation_id = "get_ai_billing_plans",
    responses(
        (status = 200, description = "Plan catalog", body = PlanCatalogResponse),
    ),
    tag = "ai_billing"
)]
pub async fn get_plans_handler() -> Json<PlanCatalogResponse> {
    Json(PlanCatalogResponse {
        plans: [PlanTier::Free, PlanTier::Premium, PlanTier::Max]
            .into_iter()
            .map(|tier| PlanCatalogEntry {
                tier,
                monthly_price_cents: tier.monthly_price_cents(),
                included_ai_cents_per_seat: tier.included_ai_cents_per_seat(),
            })
            .collect(),
        credit_packs_cents: CREDIT_PACKS_CENTS.to_vec(),
        overage_limit_min_cents: OVERAGE_LIMIT_MIN_CENTS,
        overage_limit_max_cents: OVERAGE_LIMIT_MAX_CENTS,
    })
}

/// Turn overage billing on or off and set the per-period cap. Payer only.
#[utoipa::path(
    patch,
    path = "/ai-billing/overage",
    operation_id = "update_ai_billing_overage",
    request_body = UpdateOverageRequest,
    responses(
        (status = 200, description = "Updated position", body = UsageSnapshot),
        (status = 400, description = "Invalid limit", body = AiBillingErrorBody),
        (status = 401, description = "Unauthorized"),
        (status = 402, description = "A paid plan is required", body = AiBillingErrorBody),
        (status = 403, description = "Only the payer may change billing", body = AiBillingErrorBody),
        (status = 500, description = "Internal server error", body = AiBillingErrorBody),
    ),
    tag = "ai_billing"
)]
#[tracing::instrument(skip(service, user), fields(user_id = %user.authorization.user.macro_user_id))]
pub async fn update_overage_handler<B: BillingService, Auth: MacroAuthorizationService>(
    State(service): State<Arc<B>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(req): Json<UpdateOverageRequest>,
) -> Response {
    match service
        .update_overage(
            &user.authorization.user.macro_user_id,
            req.enabled,
            req.limit_cents,
        )
        .await
    {
        Ok(snapshot) => Json(snapshot).into_response(),
        Err(e) => error_response(e),
    }
}

/// Start a Stripe Checkout for a credit pack. Payer only.
#[utoipa::path(
    post,
    path = "/ai-billing/credits/checkout",
    operation_id = "create_ai_credit_checkout",
    request_body = CreditCheckoutRequestBody,
    responses(
        (status = 200, description = "Checkout URL", body = CreditCheckoutResponse),
        (status = 400, description = "Invalid pack or no payment account", body = AiBillingErrorBody),
        (status = 401, description = "Unauthorized"),
        (status = 402, description = "A paid plan is required", body = AiBillingErrorBody),
        (status = 403, description = "Only the payer may buy credits", body = AiBillingErrorBody),
        (status = 500, description = "Internal server error", body = AiBillingErrorBody),
    ),
    tag = "ai_billing"
)]
#[tracing::instrument(skip(service, user, req), fields(user_id = %user.authorization.user.macro_user_id, cents = req.amount_cents))]
pub async fn create_credit_checkout_handler<B: BillingService, Auth: MacroAuthorizationService>(
    State(service): State<Arc<B>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(req): Json<CreditCheckoutRequestBody>,
) -> Response {
    match service
        .create_credit_checkout(
            &user.authorization.user.macro_user_id,
            req.amount_cents,
            req.success_url,
            req.cancel_url,
        )
        .await
    {
        Ok(url) => Json(CreditCheckoutResponse { url }).into_response(),
        Err(e) => error_response(e),
    }
}

/// Settle a payer's AI billing. Internal services only; called by the usage
/// recorder in other services when a payer has usage past their allowance.
#[utoipa::path(
    post,
    path = "/internal/ai-billing/settle",
    operation_id = "settle_ai_billing",
    request_body = SettleRequest,
    responses(
        (status = 204, description = "Settled"),
        (status = 400, description = "Invalid user id", body = AiBillingErrorBody),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error", body = AiBillingErrorBody),
    ),
    tag = "ai_billing"
)]
#[tracing::instrument(skip(service, _internal), fields(user_id = %req.user_id))]
pub async fn settle_handler<B: BillingService, Auth: MacroAuthorizationService>(
    State(service): State<Arc<B>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    Json(req): Json<SettleRequest>,
) -> Response {
    let user_id = match MacroUserIdStr::try_from(req.user_id) {
        Ok(id) => id,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(AiBillingErrorBody {
                    error: format!("invalid user id: {e}"),
                }),
            )
                .into_response();
        }
    };
    match service.settle(&user_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        // A declined card is reported through the payer's snapshot, not to
        // the internal caller.
        Err(BillingError::Payment(_) | BillingError::NoStripeCustomer) => {
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => error_response(e),
    }
}
