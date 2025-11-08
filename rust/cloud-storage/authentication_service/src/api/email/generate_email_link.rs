use anyhow::Context;
use axum::{
    Extension, Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use utoipa::ToSchema;

use crate::{api::context::ApiContext, config::BASE_URL, rate_limit_config::RATE_LIMIT_CONFIG};

use model::{
    response::{EmptyResponse, ErrorResponse},
    tracking::IPContext,
    user::UserContext,
};

#[derive(serde::Deserialize, serde::Serialize, ToSchema)]
pub struct GenerateEmailLinkRequest {
    /// The email address to resend the verification email to
    pub email: String,
}

static VERIFY_EMAIL_TEMPLATE: &str = include_str!("./_verify_email_template.html");

/// Generates an email link for the user to verify their email address.
#[utoipa::path(
        post,
        path = "/email/generate/link",
        operation_id = "generate_email_link",
        responses(
            (status = 200, body=EmptyResponse),
            (status = 400, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        ),
    )]
#[tracing::instrument(skip(ctx, user_context, ip_context,req), fields(client_ip=%ip_context.client_ip, email=%req.email, fusion_user_id=%user_context.fusion_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    ip_context: Extension<IPContext>,
    extract::Json(mut req): extract::Json<GenerateEmailLinkRequest>,
) -> Result<Response, Response> {
    tracing::info!("generate_email_link");
    // normalize the email before linking
    req.email = email_validator::normalize_email(&req.email)
        .context("failed to normalize email")
        .map_err(|e| {
            tracing::error!(error=?e, "failed to normalize email");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to normalize email",
            )
                .into_response()
        })?
        .to_string();

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

    // Check if the user profile already exists
    match macro_db_client::user::get::get_user_id_by_email(ctx.db.clone(), &req.email).await {
        Ok(_) => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "user profile already exists",
                }),
            )
                .into_response());
        }
        Err(e) => match e {
            sqlx::Error::RowNotFound => (),
            _ => {
                tracing::error!(error=?e, "unable to check for existing user profile");
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to check for existing user profile",
                    }),
                )
                    .into_response());
            }
        },
    }

    // Check if that email is already an in progress email link
    let link_id = if let Some((macro_user_id, link_id)) =
        macro_db_client::in_progress_email_link::check_existing_in_progress_email_link(
            &ctx.db, &req.email,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to check existing in progress email link");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to check existing in progress email link",
            )
                .into_response()
        })? {
        // if the macro_user_id matches the user_id, we count this as "regenerating" the link
        if !macro_user_id.to_string().eq(&user_context.fusion_user_id) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "email already in progress",
                }),
            )
                .into_response());
        }

        link_id
    } else {
        macro_db_client::macro_user_email_verification::upsert_macro_user_email_verification(
            &ctx.db,
            &user_context.fusion_user_id,
            &req.email,
            false,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to insert macro user email verification");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to insert macro user email verification",
            )
                .into_response()
        })?;

        macro_db_client::in_progress_email_link::insert_in_progress_email_link(
            &ctx.db,
            &user_context.fusion_user_id,
            &req.email,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to insert in progress email link");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to insert in progress email link",
            )
                .into_response()
        })?
    };

    // Send email
    let content = VERIFY_EMAIL_TEMPLATE
        .replace("{{URL}}", &BASE_URL)
        .replace("{{VERIFICATION_ID}}", &link_id.to_string());
    ctx.ses_client
        .send_email(
            "auth@macro.com",
            &req.email,
            "Verify your email address",
            &content,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to send email");
            (StatusCode::INTERNAL_SERVER_ERROR, "failed to send email").into_response()
        })?;

    // Increment the rate limits
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
