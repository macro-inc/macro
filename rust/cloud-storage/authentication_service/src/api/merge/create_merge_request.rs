use anyhow::Context;
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
    user::UserContext,
};

#[derive(serde::Deserialize, serde::Serialize, ToSchema)]
pub struct CreateAccountMergeRequest {
    /// The email address to generate the merge link for.
    pub email: String,
}

static MERGE_REQUEST_TEMPLATE: &str = include_str!("./_merge_request_template.html");

/// Creates a merge request used to verify the user's email address in order to merge their
/// accounts.
/// This is different than generate_email_link which is used to verify a new email address to add a
/// new profile to a user's account.
#[utoipa::path(
        post,
        path = "/merge",
        operation_id = "create_merge_request",
        responses(
            (status = 200, body=EmptyResponse),
            (status = 400, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 429, body=String),
            (status = 500, body=ErrorResponse),
        ),
    )]
#[tracing::instrument(skip(ctx, user_context, ip_context,req), fields(client_ip=%ip_context.client_ip, email=%req.email, fusion_user_id=%user_context.fusion_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    ip_context: Extension<IPContext>,
    extract::Json(mut req): extract::Json<CreateAccountMergeRequest>,
) -> Result<Response, Response> {
    tracing::info!("create_merge_request");

    // normalize the email
    req.email = email_validator::normalize_email(&req.email)
        .context("failed to normalize email")
        .map_err(|e| {
            tracing::error!(error=?e, "failed to normalize email");
            (StatusCode::BAD_REQUEST, "failed to normalize email").into_response()
        })?
        .to_string();

    let (minute, daily) = ctx
        .macro_cache_client
        .get_merge_email_rate_limits(&req.email)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get merge email rate limit");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to get merge email rate limit",
            )
                .into_response()
        })?;

    if let Some(minute) = minute
        && minute >= RATE_LIMIT_CONFIG.merge_email_minute.0
    {
        tracing::error!(
            rate_limit = RATE_LIMIT_CONFIG.merge_email_minute.0,
            count = minute,
            rate_limit = "minute",
            "rate_limit_exceeded"
        );
        return Err((StatusCode::TOO_MANY_REQUESTS, "rate limit exceeded").into_response());
    }

    if let Some(daily) = daily
        && daily >= RATE_LIMIT_CONFIG.merge_email_daily.0
    {
        tracing::error!(
            rate_limit = RATE_LIMIT_CONFIG.merge_email_daily.0,
            count = daily,
            rate_limit = "daily",
            "rate_limit_exceeded"
        );
        return Err((StatusCode::TOO_MANY_REQUESTS, "daily rate limit exceeded").into_response());
    }

    // get the user's macro_user_id through their email
    let to_merge_macro_user_id =
        macro_db_client::user::get::get_user_macro_id_by_email(&ctx.db, &req.email)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "failed to get user macro id");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "failed to get user macro id",
                    }),
                )
                    .into_response()
            })?;

    // Generate merge request and get code
    let code = macro_db_client::account_merge_request::create_account_merge_request(
        &ctx.db,
        &user_context.fusion_user_id,
        &to_merge_macro_user_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "failed to create account merge request");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "failed to create account merge request",
            }),
        )
            .into_response()
    })?;

    let user_profile = macro_db_client::user::get::get_user_profile(&ctx.db, &user_context.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get user profile");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to get user profile",
                }),
            )
                .into_response()
        })?;

    let content = MERGE_REQUEST_TEMPLATE
        .replace("{{EMAIL}}", &user_profile.email)
        .replace("{{CODE}}", &code);

    if let Err(e) = ctx
        .ses_client
        .send_email(
            "auth@macro.com",        // from email
            &req.email,              // to email
            "Account Merge Request", // subject
            &content,                // content
        )
        .await
    {
        tracing::error!(error=?e, "failed to send email");
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "failed to send email",
            }),
        )
            .into_response());
    }

    Ok((StatusCode::OK, Json(EmptyResponse {})).into_response())
}
