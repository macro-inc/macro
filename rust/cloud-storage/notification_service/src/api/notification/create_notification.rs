use std::str::FromStr;

use axum::{
    Extension, Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::response::ErrorResponse;
use model_notifications::{
    Notification, NotificationEvent, NotificationEventType, RawNotification,
};

use crate::{api::context::ApiContext, model::notification::CreateNotification};
use model::user::UserContext;

/// Creates a notification.
/// Will generate an id for the notification.
#[utoipa::path(
        post,
        operation_id = "create_notification",
        path = "/notifications",
        responses(
            (status = 200, body=Notification),
        )
    )]
#[tracing::instrument(skip(ctx, user_context, req))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    extract::Json(req): extract::Json<CreateNotification>,
) -> Result<Response, Response> {
    let id = macro_uuid::generate_uuid_v7();

    // Parse event item type from string to EntityType
    let event_item_type = req.event_item_type.parse().map_err(|e| {
        tracing::error!(error=?e, "invalid event item type");
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "invalid event item type",
            }),
        )
            .into_response()
    })?;

    let notification_event_type = NotificationEventType::from_str(&req.notification_event_type)
        .map_err(|e| {
            tracing::error!(error=?e, "invalid notification event type");
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "invalid notification event type",
                }),
            )
                .into_response()
        })?;

    let notification_event =
        NotificationEvent::try_from_type_and_meta(notification_event_type, req.metadata).map_err(
            |e| {
                tracing::error!(error=?e, "unable to create notification event");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to create notification event",
                    }),
                )
                    .into_response()
            },
        )?;

    let notification = Notification {
        id,
        notification_entity: model_notifications::NotificationEntity {
            event_item_id: req.event_item_id,
            event_item_type,
        },
        service_sender: req.service_sender,
        sender_id: Some(user_context.user_id.clone()),
        temporal: Default::default(),
        notification_event,
    };

    let notification = notification_db_client::notification::create::create_notification(
        ctx.db.clone(),
        RawNotification::from(notification),
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to create notification");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to create notification",
            }),
        )
            .into_response()
    })?;

    Ok((StatusCode::OK, Json(notification)).into_response())
}
