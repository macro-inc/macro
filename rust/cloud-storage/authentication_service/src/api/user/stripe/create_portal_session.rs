use axum::{Extension, Json, extract::State};
use serde::Deserialize;
use utoipa::ToSchema;

use super::{StripeOperationError, StripeSessionResponse};
use crate::api::context::ApiContext;
use model::response::ErrorResponse;
use model::user::UserContext;

/// Request body for creating a Stripe portal session
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatePortalSessionRequest {
    /// The URL to redirect to after leaving the portal
    pub return_url: String,
}

/// Creates a Stripe billing portal session.
#[utoipa::path(
    post,
    path = "/user/stripe/portal",
    operation_id = "create_portal_session",
    request_body = CreatePortalSessionRequest,
    responses(
        (status = 200, body = StripeSessionResponse),
        (status = 400, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context), err, fields(user_id = %user_context.user_id))]
pub async fn create_portal_session(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Json(req): Json<CreatePortalSessionRequest>,
) -> Result<Json<StripeSessionResponse>, StripeOperationError> {
    let user_id =
        macro_user_id::user_id::MacroUserId::parse_from_str(&user_context.user_id)?.lowercase();

    // Get the stripe customer ID from the database
    let stripe_customer_id =
        macro_db_client::user::get::get_stripe_customer_id_by_user_id(&ctx.db, &user_id)
            .await?
            .ok_or(StripeOperationError::MissingStripeId)?;

    let customer_id: stripe::CustomerId = stripe_customer_id.parse()?;

    // Create the billing portal session
    let mut params = stripe::CreateBillingPortalSession::new(customer_id);
    params.return_url = Some(req.return_url.as_str());

    let session = stripe::BillingPortalSession::create(&ctx.stripe_client, params).await?;

    // Validate but return the exact URL Stripe gave us — session URLs are signed/opaque
    // and `Url::parse(...).to_string()` can normalize in ways that break the signature.
    url::Url::parse(&session.url).map_err(|_| StripeOperationError::UnexpectedStripeResponse)?;

    Ok(Json(StripeSessionResponse { url: session.url }))
}
