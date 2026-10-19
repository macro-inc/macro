use crate::api::context::{ApiContext, AuthorizationService};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::{EmptyResponse, ErrorResponse};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum HealthCheckError {
    #[error("Database error")]
    DatabaseError(#[source] anyhow::Error),
}

impl IntoResponse for HealthCheckError {
    fn into_response(self) -> Response {
        match self {
            HealthCheckError::DatabaseError(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "internal error".into(),
                }),
            )
                .into_response(),
        }
    }
}

/// Probes the live auth state of each of the caller's inboxes (owned and delegated)
/// against the auth service and records the result on each link. A grant that died
/// while the caller was inactive is detected here within minutes instead of waiting on
/// the daily refresh sweep; the side effects (clearing or setting the reauth flag, and
/// the one-time reauth fan-out) are handled by the email service token source.
///
/// Probes are durably queued and the response returns immediately to stay off the
/// load path; each persisted flag is picked up by the next links read. Probes are
/// throttled per link in Redis so frequent calls — and many sharers of a shared inbox —
/// collapse to one refresh per window.
#[utoipa::path(
    post,
    tag = "Links",
    path = "/email/links/health-check",
    operation_id = "health_check_links",
    responses(
            (status = 202, body=EmptyResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization), fields(user_id=authorization.authorization.user.user_context.user_id, fusionauth_user_id=authorization.authorization.user.user_context.fusion_user_id), err)]
pub async fn health_check_handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> Result<Response, HealthCheckError> {
    ctx.inbox_health
        .request(&authorization.authorization.user.macro_user_id)
        .await
        .map_err(|error| HealthCheckError::DatabaseError(anyhow::Error::new(error)))?;

    Ok(StatusCode::ACCEPTED.into_response())
}
