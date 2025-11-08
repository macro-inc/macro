use axum::{
    Extension, Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use utoipa::ToSchema;

use crate::{api::context::ApiContext, rate_limit_config::RATE_LIMIT_CONFIG};

use model::{
    response::{EmptyResponse, ErrorResponse},
    tracking::IPContext,
};

#[derive(serde::Deserialize, serde::Serialize, ToSchema)]
pub struct ResendFusionauthVerifyUserEmailRequest {
    /// The email address to resend the verification email to
    pub email: String,
}

/// Resend the user's primary email verification for FusionAuth
#[utoipa::path(
        post,
        path = "/email/fusionauth_resend",
        operation_id = "resend_fusionauth_verify_user_email",
        responses(
            (status = 200, body=EmptyResponse),
            (status = 500, body=ErrorResponse),
        ),
    )]
#[tracing::instrument(skip(ctx, ip_context,req), fields(client_ip=%ip_context.client_ip, email=%req.email))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    ip_context: Extension<IPContext>,
    extract::Json(req): extract::Json<ResendFusionauthVerifyUserEmailRequest>,
) -> Result<Response, Response> {
    tracing::info!("resend_fusionauth_verify_user_email");

    let (minute, daily) = ctx
        .macro_cache_client
        .get_resend_verify_email_rate_limits(&req.email)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get resend verify email rate limit");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to get resend verify email rate limit",
            )
                .into_response()
        })?;

    if let Some(minute) = minute
        && minute >= RATE_LIMIT_CONFIG.verify_email_minute.0
    {
        tracing::error!(
            rate_limit = RATE_LIMIT_CONFIG.verify_email_minute.0,
            count = minute,
            rate_limit = "minute",
            "rate_limit_exceeded"
        );
        return Err((StatusCode::TOO_MANY_REQUESTS, "rate limit exceeded").into_response());
    }

    if let Some(daily) = daily
        && daily >= RATE_LIMIT_CONFIG.verify_email_daily.0
    {
        tracing::error!(
            rate_limit = RATE_LIMIT_CONFIG.verify_email_daily.0,
            count = daily,
            rate_limit = "daily",
            "rate_limit_exceeded"
        );
        return Err((StatusCode::TOO_MANY_REQUESTS, "daily rate limit exceeded").into_response());
    }

    ctx.auth_client
        .resend_verify_email(&req.email)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to resend verify email");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to resend verify email",
            )
                .into_response()
        })?;

    ctx.macro_cache_client
        .increment_resend_verify_email_rate_limits(&req.email)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to increment resend verify email rate limit");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to increment resend verify email rate limit",
            )
                .into_response()
        })?;

    Ok((StatusCode::OK, Json(EmptyResponse {})).into_response())
}
