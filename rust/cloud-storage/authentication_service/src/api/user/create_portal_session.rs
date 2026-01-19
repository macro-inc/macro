use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_user_id::user_id::MacroUserId;
use serde::{Deserialize, Serialize};
use stripe::{ParseIdError, StripeError};
use utoipa::ToSchema;

use crate::api::context::ApiContext;
use model::{response::ErrorResponse, user::UserContext};

/// Request body for creating a Stripe billing portal session
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatePortalSessionRequest {
    /// The URL to redirect to when the user exits the portal
    pub return_url: String,
}

/// Response containing the Stripe billing portal URL
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatePortalSessionResponse {
    /// The URL to redirect the user to for the billing portal
    pub url: String,
}

#[derive(Debug, thiserror::Error)]
pub enum CreatePortalSessionError {
    #[error("Failed to parse user id")]
    ParseId(#[from] macro_user_id::error::ParseErr),
    #[error("Internal server error")]
    DbErr(#[from] sqlx::Error),
    #[error("User does not have a stripe id")]
    MissingStripeId,
    #[error("Invalid stripe id")]
    StripeIdParse(#[from] ParseIdError),
    #[error("Internal stripe error")]
    StripeErr(#[from] StripeError),
    #[error("Internal server error")]
    UnexpectedStripeResponse,
}

impl IntoResponse for CreatePortalSessionError {
    fn into_response(self) -> Response {
        let status = match &self {
            CreatePortalSessionError::ParseId(_) => StatusCode::BAD_REQUEST,
            CreatePortalSessionError::DbErr(_) => StatusCode::INTERNAL_SERVER_ERROR,
            CreatePortalSessionError::MissingStripeId => StatusCode::BAD_REQUEST,
            CreatePortalSessionError::StripeIdParse(_) => StatusCode::BAD_REQUEST,
            CreatePortalSessionError::StripeErr(_) => StatusCode::INTERNAL_SERVER_ERROR,
            CreatePortalSessionError::UnexpectedStripeResponse => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status,
            Json(ErrorResponse {
                message: &self.to_string(),
            }),
        )
            .into_response()
    }
}

/// Creates a Stripe billing portal session for the user to manage their subscription.
#[utoipa::path(
    post,
    path = "/user/stripe/portal",
    operation_id = "create_portal_session",
    request_body = CreatePortalSessionRequest,
    responses(
        (status = 200, body = CreatePortalSessionResponse),
        (status = 400, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context), err, fields(user_id = %user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Json(req): Json<CreatePortalSessionRequest>,
) -> Result<Json<CreatePortalSessionResponse>, CreatePortalSessionError> {
    let user_id = MacroUserId::parse_from_str(&user_context.user_id)?.lowercase();

    // Get the stripe customer ID from the database
    let stripe_customer_id =
        macro_db_client::user::get::get_stripe_customer_id_by_user_id(&ctx.db, &user_id)
            .await?
            .ok_or(CreatePortalSessionError::MissingStripeId)?;

    let customer_id: stripe::CustomerId = stripe_customer_id.parse()?;

    // Create the billing portal session
    let mut params = stripe::CreateBillingPortalSession::new(customer_id);
    params.return_url = Some(req.return_url.as_str());

    let session = stripe::BillingPortalSession::create(&ctx.stripe_client, params).await?;

    let url = url::Url::parse(&session.url)
        .map_err(|_| CreatePortalSessionError::UnexpectedStripeResponse)?;

    Ok(Json(CreatePortalSessionResponse {
        url: url.to_string(),
    }))
}
