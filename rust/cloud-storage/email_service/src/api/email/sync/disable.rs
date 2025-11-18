use crate::api::context::ApiContext;
use anyhow::Context;
use axum::Extension;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use insight_service_client::InsightContextProvider;
use model::insight_context::email_insights::{
    EMAIL_INSIGHT_PROVIDER_SOURCE_NAME, EmailInfo, GenerateEmailInsightContext, LinkDeletedPayload,
};
use model::response::{EmptyResponse, ErrorResponse};
use model::user::UserContext;
use models_email::email::service::link::Link;
use models_email::service::cache::TokenCacheKey;
use models_email::service::link::UserProvider;
use sqs_client::search::SearchQueueMessage;
use sqs_client::search::email::EmailLinkMessage;
use strum_macros::AsRefStr;
use thiserror::Error;

#[derive(Debug, Error, AsRefStr)]
pub enum DisableSyncError {
    #[error("Failed to stop Gmail watch")]
    StopWatchError(#[from] anyhow::Error),

    #[error("Database query error")]
    QueryError(#[from] sqlx::Error),
}

impl IntoResponse for DisableSyncError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            DisableSyncError::StopWatchError(_) | DisableSyncError::QueryError(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };

        if status_code.is_server_error() {
            tracing::error!(
                nested_error = ?self,
                error_type = "DisableSyncError",
                variant = self.as_ref(),
                "Internal server error");
        }

        (status_code, self.to_string()).into_response()
    }
}

/// Disables inbox syncing for user.
#[utoipa::path(
    delete,
    tag = "Sync",
    path = "/email/sync",
    operation_id = "disable_sync",
    responses(
            (status = 204),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context, link, gmail_token), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id))]
pub async fn disable_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    link: Extension<Link>,
    gmail_token: Extension<String>,
) -> Result<Response, DisableSyncError> {
    tracing::info!(user_id = %user_context.user_id, "Disable called");
    // should cancel backfill jobs
    if let Err(e) =
        email_db_client::backfill::job::update::cancel_active_jobs_by_link_id(&ctx.db, link.id)
            .await
    {
        tracing::error!(error=?e, link_id=?link.id, "Failed to update backfill job statuses");
    };

    // delete cached access token, in case user re-enables within cache window
    if let Err(e) = ctx
        .redis_client
        .delete_gmail_access_token(&TokenCacheKey {
            fusion_user_id: link.fusionauth_user_id.clone(),
            macro_id: link.macro_id.clone(),
            provider: UserProvider::Gmail,
        })
        .await
    {
        tracing::warn!(error=?e, "Failed to delete Gmail access token");
    };

    // make call to gmail to unregister
    ctx.gmail_client
        .stop_watch(gmail_token.as_str())
        .await
        .context("Gmail call to stop watch failed")?;

    email_db_client::links::update::update_link_sync_status(&ctx.db, link.id, false)
        .await
        .context("Failed to update link sync status")?;

    // TODO: this will need to be dynamic once we have multiple email providers
    let _ = ctx
        .auth_service_client
        .remove_link(
            &user_context.fusion_user_id,
            &user_context.user_id,
            "google_gmail",
        )
        .await
        .inspect_err(|e| {
            tracing::error!(error=?e, "unable to unlink idp");
        });

    // delete all of the user's data from the database.
    let db = ctx.db.clone();
    let link_id = link.id;
    let link_context_cloned = link.clone();
    tokio::spawn(async move {
        // send message to search text extractor queue
        ctx.sqs_client
            .send_message_to_search_event_queue(SearchQueueMessage::RemoveEmailLink(
                EmailLinkMessage {
                    link_id: link_context_cloned.id.to_string(),
                },
            ))
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, "failed to send message to search extractor queue");
            })
            .ok();

        // send message to insights queue

        let email_info = EmailInfo::LinkDeleted(LinkDeletedPayload {
            link_id: link_context_cloned.id.to_string(),
            email_address: link_context_cloned.email_address.clone(),
        });

        let insights_message = GenerateEmailInsightContext {
            macro_user_id: link_context_cloned.macro_id.clone(),
            info: email_info,
        };

        let provider = InsightContextProvider::create(
            ctx.sqs_client.as_ref().clone(),
            EMAIL_INSIGHT_PROVIDER_SOURCE_NAME,
        );

        provider.provide_email_context(insights_message).await.ok();

        if let Err(e) = email_db_client::links::delete::delete_link_by_id(&db, link_id).await {
            tracing::error!(error=?e, link_id=?link_id, "Failed to delete link in background task");
        } else {
            tracing::info!(link_id=?link_id, "Successfully deleted link in background task");
        }
    });

    Ok(StatusCode::NO_CONTENT.into_response())
}
