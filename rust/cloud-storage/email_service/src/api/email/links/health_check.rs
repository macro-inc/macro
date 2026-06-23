use crate::api::context::ApiContext;
use axum::Extension;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use email_service::util::gmail::auth::{
    fetch_token_or_mark_reauth_no_cache, is_reauth_required_error,
};
use model::response::{EmptyResponse, ErrorResponse};
use model::user::UserContext;
use models_email::email::service::pubsub::LinkManagerMessage;
use std::time::Duration;
use thiserror::Error;

/// How long a per-link probe window stands before another probe may run for it.
const HEALTH_PROBE_THROTTLE: Duration = Duration::from_secs(15 * 60);

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
/// the one-time reauth fan-out) are handled by `fetch_token_or_mark_reauth_no_cache`.
///
/// Probes run in the background and the response returns immediately to stay off the
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
#[tracing::instrument(skip(ctx, user_context), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id), err)]
pub async fn health_check_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
) -> Result<Response, HealthCheckError> {
    let links =
        email_db_client::links::get::fetch_inboxes_for_macro_id(&ctx.db, &user_context.user_id)
            .await
            .map_err(HealthCheckError::DatabaseError)?;

    for link in links {
        if !link.is_sync_active {
            continue;
        }

        let ctx = ctx.clone();
        tokio::spawn(async move {
            if !ctx
                .redis_client
                .try_begin_health_probe(link.id, HEALTH_PROBE_THROTTLE)
                .await
            {
                return;
            }

            let probe = fetch_token_or_mark_reauth_no_cache(
                &link,
                &ctx.db,
                &ctx.redis_client,
                &ctx.auth_service_client,
                &ctx.sqs_client,
            )
            .await;

            let Err(e) = probe else { return };

            if !is_reauth_required_error(&e) {
                tracing::debug!(error=?e, link_id=%link.id, "Health probe token fetch failed");
                return;
            }

            // A revoked grant marks the link and fans out as a side effect of the probe.
            // If that mark did not persist, the signal would be lost on this fire-and-forget
            // path, so hand off to the link-manager queue, which retries until it sticks.
            let persisted = email_db_client::links::get::fetch_link_by_id(&ctx.db, link.id)
                .await
                .ok()
                .flatten()
                .is_some_and(|l| l.needs_reauth);

            if !persisted {
                ctx.sqs_client
                    .enqueue_link_manager_notification(LinkManagerMessage::HealthCheck {
                        link_id: link.id,
                    })
                    .await
                    .inspect_err(|enqueue_err| {
                        tracing::error!(error=?enqueue_err, link_id=%link.id, "Failed to enqueue health-check retry after unpersisted reauth");
                    })
                    .ok();
            }
        });
    }

    Ok(StatusCode::ACCEPTED.into_response())
}
