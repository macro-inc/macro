use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::response::{EmptyResponse, ErrorResponse};

use crate::{api::context::ApiContext, notification};
use model::user::UserContext;

#[derive(serde::Deserialize)]
pub struct Params {
    pub event_item_id: String,
}

/// Marks the user's notification as seen for a given event item id and type.
#[utoipa::path(
        patch,
        operation_id = "bulk_mark_user_notification_seen_by_event",
        path = "/user_notifications/item/{event_item_id}/seen",
        params(
            ("event_item_id" = String, Path, description = "ID of the event item")
        ),
        responses(
            (status = 200, body=EmptyResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(Params { event_item_id }): Path<Params>,
) -> Result<Response, Response> {
    tracing::info!("bulk_mark_user_notification_seen_by_event");

    let notification_ids =
        notification_db_client::user_notification::patch::seen::bulk_patch_seen_by_event(
            &ctx.db,
            &user_context.user_id,
            &event_item_id,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to patch user notification seen for event");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to patch user notification seen for event",
                }),
            )
                .into_response()
        })?;

    if !notification_ids.is_empty() {
        // We only need the first notification as all basic info will be the same
        let basic_notification_information =
            notification_db_client::notification::get::get_basic_notification(
                &ctx.db,
                &notification_ids[0].to_string(),
            )
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "failed to get basic notification information");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "failed to get basic notification information",
                    }),
                )
                    .into_response()
            })?;

        if basic_notification_information.event_item_type == "channel" {
            tokio::spawn({
                let db = ctx.db.clone();
                let basic_notification_information = basic_notification_information.clone();
                let user_id = user_context.user_id.clone();
                async move {
                    if let Err(e) = notification_db_client::channel_notification_email_sent::delete::delete_channel_notification_email_sent(
                        &db,
                        &basic_notification_information.event_item_id,
                        &user_id,
                    )
                    .await {
                        tracing::error!(error=?e, basic_notification_information=?basic_notification_information, user_id=?user_id, "failed to delete channel notification email sent");
                    }
                }
            });
        }

        tokio::spawn({
            let ctx = ctx.clone();
            let user_id = user_context.user_id.clone();
            let basic_notification_information = basic_notification_information.clone();
            async move {
                if let Err(e) = notification::send::push::remove::clear_push_notifications_basic(
                    ctx.clone(),
                    &user_id,
                    &basic_notification_information,
                )
                .await
                {
                    tracing::error!(error=?e, "failed to remove push notifications");
                }
            }
        });
    }

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
