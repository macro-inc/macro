use crate::api::context::{ApiContext, AuthorizationService};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use email_api_client::domain::models::{EmailApiError, TokenFreshness};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::{EmptyResponse, ErrorResponse};
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
/// the one-time reauth fan-out) are handled by the email service token source.
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
#[tracing::instrument(skip(ctx, authorization), fields(user_id=authorization.authorization.user.user_context.user_id, fusionauth_user_id=authorization.authorization.user.user_context.fusion_user_id), err)]
pub async fn health_check_handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> Result<Response, HealthCheckError> {
    let links = email_db_client::links::get::fetch_inboxes_for_macro_id(
        &ctx.db,
        &authorization.authorization.user.user_context.user_id,
    )
    .await
    .map_err(HealthCheckError::DatabaseError)?;

    // The web app calls this on mount and on window focus, so it doubles as the
    // "user opened the app" signal that drives mailbox retention.
    tokio::spawn({
        let ctx = ctx.clone();
        let link_ids: Vec<_> = links.iter().map(|link| link.id).collect();
        async move { record_activity_and_resume(&ctx, &link_ids).await }
    });

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

            let probe = ctx
                .email_api
                .get_access_token(link.id, TokenFreshness::Fresh)
                .await;

            let Err(error) = probe else { return };

            if !matches!(error, EmailApiError::AuthRequired) {
                tracing::debug!(error=?error, link_id=%link.id, "Health probe token fetch failed");
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

/// Records app activity on the caller's inboxes and restarts sync for any the
/// retention sweep had paused. A resumed link skips this request's health probe;
/// its resume fetches a fresh token instead.
async fn record_activity_and_resume(ctx: &ApiContext, link_ids: &[uuid::Uuid]) {
    let resumed =
        match email_db_client::links::retention::record_link_activity(&ctx.db, link_ids).await {
            Ok(resumed) => resumed,
            Err(error) => {
                tracing::error!(error=?error, "Failed to record inbox activity");
                return;
            }
        };

    for link_id in resumed {
        tracing::info!(link_id=%link_id, "Resuming sync for paused inbox");
        let Err(error) = ctx
            .sqs_client
            .enqueue_link_manager_notification(LinkManagerMessage::ResumeSync { link_id })
            .await
        else {
            continue;
        };
        tracing::error!(error=?error, link_id=%link_id, "Failed to enqueue inbox resume; restoring its pause so the next app open retries");
        email_db_client::links::retention::restore_link_pause(&ctx.db, link_id)
            .await
            .inspect_err(|error| {
                tracing::error!(error=?error, link_id=%link_id, "Failed to restore pause after unsent inbox resume");
            })
            .ok();
    }
}
