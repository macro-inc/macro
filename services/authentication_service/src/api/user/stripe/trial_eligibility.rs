//! Authenticated, read-only introductory trial eligibility.

use axum::{Json, extract::State};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::ErrorResponse;

use super::StripeOperationError;
use crate::api::context::{ApiContext, AuthorizationService};
use crate::service::subscription_checkout::TrialEligibility;

/// Read the caller's eligibility; checkout revalidates before granting a trial.
#[utoipa::path(
    get,
    path = "/user/stripe/trial_eligibility",
    operation_id = "get_trial_eligibility",
    responses(
        (status = 200, body = TrialEligibility),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, err)]
pub async fn trial_eligibility(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> Result<Json<TrialEligibility>, StripeOperationError> {
    Ok(Json(
        ctx.subscription_checkout
            .trial_eligibility(&user.authorization.user.macro_user_id)
            .await?,
    ))
}
