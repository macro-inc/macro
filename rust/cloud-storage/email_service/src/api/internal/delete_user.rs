use crate::api::context::ApiContext;
use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use model::response::ErrorResponse;
use models_email::email::service::pubsub::LinkManagerMessage;

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
                message: "unable to fetch links".into(),
            }),
        )
            .into_response()
    })?;

    for link in links {
        let message = LinkManagerMessage::DeleteLink {
            link_id: link.id,
            deletion_reason: models_email::email::service::pubsub::DeletionReason::UserDeleted,
        };

        ctx.sqs_client
            .enqueue_link_manager_notification(message)
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, link_id=?link.id, "Failed to enqueue delete notification");
            })
            .ok();
    }

    Ok(StatusCode::NO_CONTENT.into_response())
}
