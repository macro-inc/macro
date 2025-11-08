use std::borrow::Cow;

use crate::{api::context::ApiContext, rate_limit_config::RATE_LIMIT_CONFIG};
use axum::{
    Extension,
    body::Body,
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use http_body_util::BodyExt;
use model::tracking::IPContext;

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct RequestWithEmail {
    /// The email of the user to setup passwordless login for
    pub email: String,
}

/// Rate limit for passwordless logins
/// For rate limiting, we use the key `rtl_passwordless:${email}`
#[tracing::instrument(skip(ctx, req, next, ip_context), fields(client_ip=%ip_context.client_ip))]
pub(in crate::api) async fn handler(
    State(ctx): State<ApiContext>,
    ip_context: Extension<IPContext>,
    req: Request,
    next: Next,
) -> Result<Response, Response> {
    #[cfg(feature = "disable_rate_limit")]
    {
        tracing::trace!("rate limit disabled");
        return Ok(next.run(req).await);
    }

    let (parts, body) = req.into_parts();

    // this wont work if the body is an long running stream
    let bytes = match body.collect().await {
        Ok(bytes) => bytes.to_bytes(),
        Err(e) => {
            tracing::error!(error=?e, "failed to collect body");
            return Err(StatusCode::INTERNAL_SERVER_ERROR.into_response());
        }
    };

    let parsed_body = match serde_json::from_slice::<RequestWithEmail>(&bytes) {
        Ok(result) => result,
        Err(e) => {
            tracing::error!(error=?e, "failed to parse body");
            return Err((StatusCode::BAD_REQUEST, "failed to parse body").into_response());
        }
    };

    let email = parsed_body.email.to_lowercase();

    if !email_validator::is_valid_email(&email) {
        tracing::error!(email=%email, "invalid email");
        return Err((StatusCode::BAD_REQUEST, "invalid email").into_response());
    }

    let email_without_alias = email_validator::remove_email_alias(&email)
        .unwrap_or(Cow::Borrowed(email.as_str()))
        .to_string();

    let count = match ctx
        .macro_cache_client
        .get_passwordless_rate_limit(&email_without_alias)
        .await
    {
        Ok(count) => count,
        Err(e) => {
            tracing::error!(error=?e, "failed to get rate limit");
            // This happens when the key does not exist
            if !e
                .to_string()
                .contains("Response type not convertible to numeric.")
            {
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "failed to get rate limit",
                )
                    .into_response());
            }
            None
        }
    };

    let count = count.unwrap_or(0);

    if count >= RATE_LIMIT_CONFIG.passwordless.0 {
        tracing::error!(
            email = email,
            email_without_alias = email_without_alias,
            rate_limit = RATE_LIMIT_CONFIG.passwordless.0,
            count = count,
            rate_limit = "minute",
            "rate_limit_exceeded"
        );
        return Err((StatusCode::TOO_MANY_REQUESTS, "rate limit exceeded").into_response());
    }

    if let Err(e) = ctx
        .macro_cache_client
        .increment_passwordless_rate_limit(&email_without_alias, RATE_LIMIT_CONFIG.passwordless.1)
        .await
    {
        tracing::error!(error=?e, "failed to increment rate limit");
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "failed to increment rate limit",
        )
            .into_response());
    }

    let daily_count = match ctx
        .macro_cache_client
        .get_daily_passwordless_rate_limit(&email_without_alias)
        .await
    {
        Ok(count) => count,
        Err(e) => {
            tracing::error!(error=?e, "failed to get daily rate limit");
            // This happens when the key does not exist
            if !e
                .to_string()
                .contains("Response type not convertible to numeric.")
            {
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "failed to get rate limit",
                )
                    .into_response());
            }
            None
        }
    };

    let daily_count = daily_count.unwrap_or(0);

    if daily_count >= RATE_LIMIT_CONFIG.passwordless_daily.0 {
        tracing::error!(
            email = email,
            email_without_alias = email_without_alias,
            rate_limit = RATE_LIMIT_CONFIG.passwordless_daily.0,
            daily_count = daily_count,
            rate_limit = "daily",
            "rate_limit_exceeded"
        );
        return Err((StatusCode::TOO_MANY_REQUESTS, "daily rate limit exceeded").into_response());
    }

    if let Err(e) = ctx
        .macro_cache_client
        .increment_passwordless_daily_rate_limit(
            &email_without_alias,
            RATE_LIMIT_CONFIG.passwordless_daily.1,
        )
        .await
    {
        tracing::error!(error=?e, "failed to increment daily rate limit");
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "failed to increment daily rate limit",
        )
            .into_response());
    }

    // reform request
    let request = Request::from_parts(parts, Body::from(bytes));
    Ok(next.run(request).await)
}
