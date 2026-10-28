use crate::service::subscription_checkout::CheckoutRequest;
use axum::{Json, extract::State};
use entity_access::domain::models::OwnerTeamRole;
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::OptionalMacroUserTeamExtractorV2;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{PaidPlan, StripeOperationError};
use crate::api::context::{ApiContext, AuthorizationService};
use model::response::ErrorResponse;

/// Tracking metadata for conversion attribution
#[derive(Debug, Default, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutSessionMetadata {
    /// Google Analytics client ID for conversion tracking
    pub ga_client_id: Option<String>,
    /// Meta (Facebook) browser ID from _fbp cookie
    pub fbp: Option<String>,
    /// Meta (Facebook) click ID from _fbc cookie
    pub fbc: Option<String>,
}

/// Request body for creating a Stripe checkout session
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateCheckoutSessionV2Request {
    /// The URL to redirect to on successful checkout
    pub success_url: String,
    /// The URL to redirect to if checkout is cancelled
    pub cancel_url: String,
    /// Optional discount/promo code to apply
    pub discount: Option<String>,
    /// Tracking metadata for conversion attribution
    #[serde(default)]
    pub metadata: CheckoutSessionMetadata,
    /// The plan to subscribe to. Defaults to Premium.
    #[serde(default)]
    pub plan: Option<PaidPlan>,
    /// Request the automatic, first-subscription 30-day Premium trial.
    #[serde(default)]
    pub onboarding_trial: bool,
}

/// Hosted checkout with the billing terms the server actually granted.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutSessionV2Response {
    /// The opaque URL returned by Stripe.
    pub url: String,
    /// Trial duration, absent for an immediately paid checkout.
    pub trial_days: Option<u8>,
}

/// Creates a Stripe checkout session for the user to subscribe.
#[utoipa::path(
    post,
    path = "/user/stripe/checkoutv2",
    operation_id = "create_checkout_session_v2",
    request_body = CreateCheckoutSessionV2Request,
    responses(
        (status = 200, body = CheckoutSessionV2Response),
        (status = 400, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user, optional_team), err, fields(user_id = %user.authorization.user.macro_user_id))]
pub async fn create_checkout_session<Eas: EntityAccessService>(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    optional_team: OptionalMacroUserTeamExtractorV2<OwnerTeamRole, Eas, AuthorizationService>,
    Json(req): Json<CreateCheckoutSessionV2Request>,
) -> Result<Json<CheckoutSessionV2Response>, StripeOperationError> {
    // Build subscription metadata from optional tracking fields
    let mut metadata = std::collections::HashMap::new();

    // If the user is the owner of a team, we need to insert team metadata into subscription
    if let Some(team) = optional_team.entity_access_receipt {
        let team_id = team.entity().entity_id.clone();
        metadata.insert("team_id".to_string(), team_id);

        metadata.insert(
            "owner_id".to_string(),
            user.authorization.user.macro_user_id.to_string(),
        );
    }

    if let Some(ga_client_id) = req.metadata.ga_client_id {
        metadata.insert("ga_client_id".to_string(), ga_client_id);
    }
    if let Some(fbp) = req.metadata.fbp {
        metadata.insert("fbp".to_string(), fbp);
    }
    if let Some(fbc) = req.metadata.fbc {
        metadata.insert("fbc".to_string(), fbc);
    }

    let checkout = ctx
        .subscription_checkout
        .create(CheckoutRequest {
            user_id: user.authorization.user.macro_user_id.clone(),
            plan: req.plan.unwrap_or(PaidPlan::Premium),
            onboarding_trial: req.onboarding_trial,
            success_url: req.success_url,
            cancel_url: req.cancel_url,
            discount: req.discount,
            metadata,
        })
        .await?;
    Ok(Json(CheckoutSessionV2Response {
        url: checkout.url,
        trial_days: checkout.trial_days,
    }))
}
