use axum::{
    Json, Router,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use model::response::ErrorResponse;
use thiserror::Error;
use tower::ServiceBuilder;
use utoipa::ToSchema;

use crate::api::{context::ApiContext, middleware};

#[derive(Debug, Error)]
pub enum SendMobileWelcomeEmailError {
    #[error("Invalid email address")]
    InvalidEmail,

    #[error("Email is blocked")]
    EmailBlocked,

    #[error("Internal error")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for SendMobileWelcomeEmailError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            SendMobileWelcomeEmailError::InvalidEmail
            | SendMobileWelcomeEmailError::EmailBlocked => StatusCode::BAD_REQUEST,
            SendMobileWelcomeEmailError::InternalError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        (
            status_code,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

#[derive(Debug, serde::Deserialize, serde::Serialize, ToSchema)]
pub struct SendMobileWelcomeEmailRequest {
    /// The email address to send the welcome email to
    pub email: String,
}

#[derive(Debug, serde::Serialize, ToSchema)]
pub struct SendMobileWelcomeEmailResponse {
    /// Whether the lead was enrolled (false if they were already enrolled previously)
    pub sent: bool,
}

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new().route(
        "/mobile-welcome-email",
        post(handler).layer(
            ServiceBuilder::new().layer(axum::middleware::from_fn_with_state(
                state,
                middleware::rate_limit::mobile_welcome_email::handler,
            )),
        ),
    )
}

/// Enrolls a mobile lead in the Loops nurture sequence, which sends the welcome
/// email inviting them to register on desktop. No-ops if the address was already
/// enrolled, and rejects blocked addresses.
#[utoipa::path(
    post,
    path = "/mobile-welcome-email",
    operation_id = "send_mobile_welcome_email",
    responses(
        (status = 200, body = SendMobileWelcomeEmailResponse),
        (status = 400, body = ErrorResponse),
        (status = 429, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx), fields(email=%req.email), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    extract::Json(req): extract::Json<SendMobileWelcomeEmailRequest>,
) -> Result<Json<SendMobileWelcomeEmailResponse>, SendMobileWelcomeEmailError> {
    if !email_validator::is_valid_email(&req.email) {
        return Err(SendMobileWelcomeEmailError::InvalidEmail);
    }

    let lowercase_email = loops_client::normalize_email(&req.email);

    // Check if the email is blocked
    let blocked_emails =
        macro_db_client::blocked_email::get_blocked_emails(&ctx.db, &[&lowercase_email]).await?;

    if !blocked_emails.is_empty() {
        return Err(SendMobileWelcomeEmailError::EmailBlocked);
    }

    // Atomically claim the slot — returns false if the email was already sent
    let inserted =
        mobile_welcome_email_db_client::mobile_welcome_email::insert_mobile_welcome_email(
            &ctx.db,
            &lowercase_email,
        )
        .await?;

    if !inserted {
        return Ok(Json(SendMobileWelcomeEmailResponse { sent: false }));
    }

    // Enrolls the lead in the Loops nurture sequence, which owns the welcome
    // email from here. Awaited rather than fire-and-forget: `sent: true` tells
    // the caller mail is on the way, so it must not report success on a
    // Loops failure. The key is namespaced by event so it can't collide with
    // the `user_registered` event sent when the lead converts.
    ctx.loops_client
        .send_event(
            &lowercase_email,
            "mobile_lead_captured",
            // `hasAccount` is set explicitly rather than left unset: the
            // workflow's audience filter tests `isFalse`, which an absent
            // property would not satisfy.
            &serde_json::json!({
                "signupStage": "lead",
                "hasAccount": false,
                "source": "mobile-lead-capture",
            }),
            Some(&format!("mobile-lead-{lowercase_email}")),
        )
        .await
        .map_err(|e| SendMobileWelcomeEmailError::InternalError(e.into()))?;

    Ok(Json(SendMobileWelcomeEmailResponse { sent: true }))
}
