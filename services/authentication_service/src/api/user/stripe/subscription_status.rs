//! Authenticated adapter for the caller's renewal and pending seat change.

use axum::{Json, extract::State};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};

use super::StripeOperationError;
use crate::api::context::{ApiContext, AuthorizationService};
use crate::service::subscription_status::SubscriptionStatus;
use model::response::ErrorResponse;

/// Read subscription state for the authenticated user's seat.
#[utoipa::path(
    get,
    path = "/user/stripe/plan",
    operation_id = "get_subscription_status",
    responses(
        (status = 200, body = SubscriptionStatus),
        (status = 401, body = ErrorResponse),
        (status = 409, description = "More than one active subscription", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user), err)]
pub async fn subscription_status(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> Result<Json<SubscriptionStatus>, StripeOperationError> {
    Ok(Json(
        ctx.subscription_status
            .status(&user.authorization.user.macro_user_id)
            .await?,
    ))
}
