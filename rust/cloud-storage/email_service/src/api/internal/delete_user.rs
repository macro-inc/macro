use crate::api::context::ApiContext;
use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use model::response::ErrorResponse;
use sqs_client::search::SearchQueueMessage;
use sqs_client::search::email::EmailLinkMessage;

#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    Path(fusionauth_user_id): Path<String>,
) -> Result<Response, Response> {
    tracing::info!(user_id = fusionauth_user_id, "Delete user called");

    let links = email_db_client::links::get::fetch_links_by_fusionauth_user_id(
        &ctx.db,
        &fusionauth_user_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to fetch links");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to fetch links",
            }),
        )
            .into_response()
    })?;

    for link in links {
        // should cancel backfill jobs
        if let Err(e) =
            email_db_client::backfill::job::update::cancel_active_jobs_by_link_id(&ctx.db, link.id)
                .await
        {
            tracing::error!(error=?e, link_id=?link.id, "Failed to update backfill job statuses");
        };

        let gmail_access_token = match crate::util::gmail::auth::fetch_gmail_access_token_from_link(
            &link,
            &ctx.redis_client,
            &ctx.auth_service_client,
        )
        .await
        {
            Ok(token) => Some(token),
            Err(e) => {
                tracing::error!(error=?e, link_id=?link.id, "unable to fetch access token - skipping stop watch");
                None
            }
        };

        if let Some(token) = gmail_access_token
            && let Err(e) = ctx.gmail_client.stop_watch(&token).await
        {
            tracing::error!(error=?e, link_id=?link.id, "gmail call to stop watch failed");
        }

        if let Err(e) =
            email_db_client::links::update::update_link_sync_status(&ctx.db, link.id, false).await
        {
            tracing::error!(error=?e, link_id=?link.id, "update link sync status failed");
        }

        // delete all of the user's data from the database.
        let db = ctx.db.clone();
        let sqs_client = ctx.sqs_client.clone();
        let link_id = link.id;
        let macro_user_id = link.macro_id;
        tokio::spawn(async move {
            // send message to search text extractor queue
            sqs_client
                .send_message_to_search_event_queue(SearchQueueMessage::RemoveEmailLink(
                    EmailLinkMessage {
                        link_id: link.id.to_string(),
                        macro_user_id,
                    },
                ))
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, "failed to send message to search extractor queue");
                })
                .ok();

            if let Err(e) = email_db_client::links::delete::delete_link_by_id(&db, link_id).await {
                tracing::error!(error=?e, link_id=?link_id, "Failed to delete link in background task");
            } else {
                tracing::info!(link_id=?link_id, "Successfully deleted link in background task");
            }
        });
    }

    Ok(StatusCode::NO_CONTENT.into_response())
}
