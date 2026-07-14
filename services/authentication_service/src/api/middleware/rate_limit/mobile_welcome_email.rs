use crate::{api::context::ApiContext, rate_limit_config::RATE_LIMIT_CONFIG};
use axum::{
    Json,
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use macro_middleware::tracking::ClientIp;
use model::response::ErrorResponse;

/// IP-based rate limit for mobile welcome email requests.
#[tracing::instrument(skip(ctx, req, next, ip_context), fields(client_ip=%ip_context), err(Debug))]
pub(in crate::api) async fn handler(
    State(ctx): State<ApiContext>,
    ip_context: ClientIp,
    req: Request,
    next: Next,
) -> Result<Response, Response> {
    if cfg!(not(feature = "rate_limit")) {
        tracing::trace!("rate limit disabled");
        return Ok(next.run(req).await);
    }

    let ip = ip_context.to_string();

    let count = ctx
        .macro_cache_client
        .get_mobile_welcome_email_rate_limit(&ip)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get rate limit");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to get rate limit".into(),
                }),
            )
                .into_response()
        })?
        .unwrap_or(0);

    if count >= RATE_LIMIT_CONFIG.mobile_welcome_email.0 {
        tracing::error!(
            ip = ip,
            rate_limit = RATE_LIMIT_CONFIG.mobile_welcome_email.0,
            count = count,
            "rate_limit_exceeded"
        );
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(ErrorResponse {
                message: "rate limit exceeded".into(),
            }),
        )
            .into_response());
    }

    ctx.macro_cache_client
        .increment_mobile_welcome_email_rate_limit(&ip, RATE_LIMIT_CONFIG.mobile_welcome_email.1)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to increment rate limit");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to increment rate limit".into(),
                }),
            )
                .into_response()
        })?;

    Ok(next.run(req).await)
}
