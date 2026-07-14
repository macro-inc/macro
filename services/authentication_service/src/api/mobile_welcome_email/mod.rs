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

static WELCOME_EMAIL_TEMPLATE: &str = include_str!("./_welcome_email_template.html");

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
    /// Whether the email was sent (false if it was already sent previously)
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

/// Sends a mobile welcome email to the given address, if it hasn't already been sent
/// and the email is not blocked.
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

    let lowercase_email = req.email.to_lowercase();
    let lowercase_email = if let Some((local, domain)) = lowercase_email.split_once('@') {
        let local = local.split('+').next().unwrap_or(local);
        format!("{local}@{domain}")
    } else {
        lowercase_email
    };

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

    let welcome_email_content = WELCOME_EMAIL_TEMPLATE.to_string();
    ctx.ses_client
        .send_email(
            "noreply@macro.com",
            &lowercase_email,
            "Welcome to Macro",
            &welcome_email_content,
        )
        .await?;

    Ok(Json(SendMobileWelcomeEmailResponse { sent: true }))
}
