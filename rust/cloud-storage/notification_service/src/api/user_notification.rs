use std::{collections::HashSet, sync::LazyLock};

use ::notification::domain::models::UserNotificationRow;
use axum::extract::State;
use chrono::{DateTime, Utc};
use email_formatting::EmailDigestNotification;
use itertools::{Either, Itertools};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use model_error_response::ErrorResponse;
use model_notifications::{
    AiResponseMetadata, ChannelMentionMetadata, ChannelMessageSendMetadata, ChannelReplyMetadata,
    CommentedOnDocumentMetadata, DocumentMentionMetadata, MentionedInDocumentCommentMetadata,
    NewEmailMetadata, NotifEvent, RepliedToDocumentCommentThreadMetadata, TaskAssignedMetadata,
};
use notification::{
    domain::{models::Notification, service::NotificationReader},
    inbound::http::NotificationRouterState,
};
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

/// The types of notifications that are blockable
pub(crate) static BLOCKABLE_NOTIFICATIONS: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    HashSet::from([
        EmailDigestNotification::TYPE_NAME,
        NewEmailMetadata::TYPE_NAME,
        AiResponseMetadata::TYPE_NAME,
        ChannelMessageSendMetadata::TYPE_NAME,
        ChannelMentionMetadata::TYPE_NAME,
        ChannelReplyMetadata::TYPE_NAME,
        DocumentMentionMetadata::TYPE_NAME,
        TaskAssignedMetadata::TYPE_NAME,
        MentionedInDocumentCommentMetadata::TYPE_NAME,
        RepliedToDocumentCommentThreadMetadata::TYPE_NAME,
        CommentedOnDocumentMetadata::TYPE_NAME,
    ])
});

#[cfg(test)]
mod test;

#[derive(Debug, Serialize, ToSchema)]
pub struct ApiUserNotification {
    /// The user who owns this notification.
    #[schema(value_type = String)]
    pub owner_id: MacroUserIdStr<'static>,
    /// The notification ID.
    #[serde(rename = "id")]
    pub notification_id: uuid::Uuid,
    /// The notification event type string (e.g. "channel_mention").
    /// TODO make this a new type
    pub notification_event_type: String,
    /// The entity the notification is about.
    #[serde(flatten)]
    pub entity: Entity<'static>,
    /// Whether the notification has been sent.
    pub sent: bool,
    /// Whether the notification is marked as done.
    pub done: bool,
    /// When the notification was created.
    pub created_at: DateTime<Utc>,
    /// When the notification was viewed/seen.
    pub viewed_at: Option<DateTime<Utc>>,
    /// When the notification was last updated.
    pub updated_at: DateTime<Utc>,
    /// When the notification was deleted.
    pub deleted_at: Option<DateTime<Utc>>,
    /// Deserialized notification metadata.
    pub notification_metadata: NotifEvent,
    /// The user who triggered the notification.
    #[schema(value_type = Option<String>)]
    pub sender_id: Option<MacroUserIdStr<'static>>,
}

impl ApiUserNotification {
    pub fn from_notification(v: UserNotificationRow<NotifEvent>) -> Self {
        let UserNotificationRow {
            owner_id,
            notification_id,
            notification_event_type,
            entity,
            sent,
            done,
            created_at,
            viewed_at,
            updated_at,
            deleted_at,
            notification_metadata,
            sender_id,
        } = v;
        ApiUserNotification {
            owner_id,
            notification_id,
            notification_event_type,
            entity,
            sent,
            done,
            created_at,
            viewed_at,
            updated_at,
            deleted_at,
            notification_metadata,
            sender_id,
        }
    }
}

/// The strongly typed response for listing user notifications.
#[derive(Debug, Serialize, ToSchema)]
pub struct GetAllUserNotificationsResponse {
    /// The list of items returned.
    pub items: Vec<ApiUserNotification>,
    /// The next page cursor if it exists.
    pub next_cursor: Option<String>,
}

/// Convert a [`UserNotificationRow<serde_json::Value>`] into a
/// [`UserNotificationRow<NotifEvent>`] by tagging and deserializing the metadata.
#[tracing::instrument(err)]
pub fn to_typed_row(
    row: UserNotificationRow<serde_json::Value>,
) -> Result<UserNotificationRow<NotifEvent>, serde_json::Error> {
    row.into_tagged().deserialize_metadata()
}

/// Build the strongly typed router.
///
/// Instantiates the notification crate's generic router, then overwrites the
/// GET `/` route with a wrapper that deserializes each row into [`NotifEvent`].
pub fn router<S: ::notification::domain::service::NotificationReader>()
-> axum::Router<NotificationRouterState<S>> {
    ::notification::inbound::http::router::<S, serde_json::Value>()
        .route("/", axum::routing::get(list_typed_notifications::<S>))
        .route(
            "/item/bulk",
            axum::routing::post(bulk_get_typed_notifications_by_event_item_ids::<S>),
        )
        .route(
            "/item/{event_item_id}",
            axum::routing::get(get_typed_by_event_item_id::<S>),
        )
        .route(
            "/{notification_id}",
            axum::routing::get(get_typed_notification_by_id::<S>)
                .delete(::notification::inbound::http::delete_notification::<S>),
        )
}

/// Wrapper handler that calls the inner generic list handler with `serde_json::Value`,
/// then converts each row to [`UserNotificationRow<NotifEvent>`].
///
/// Rows that fail to deserialize are dropped with a warning log.
#[utoipa::path(
    get,
    operation_id = "list_typed_notifications",
    path = "/v1/user_notifications",
    params(
        ("limit" = Option<u32>, Query, description = "Size limit per page."),
        ("cursor" = Option<String>, Query, description = "Cursor value. Base64 encoded timestamp and item id."),
    ),
    responses(
        (status = 200, body = GetAllUserNotificationsResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
async fn list_typed_notifications<S: ::notification::domain::service::NotificationReader>(
    State(state): State<::notification::inbound::http::NotificationRouterState<S>>,
    decoded_jwt: decode_jwt::DecodedJwt,
    query: axum::extract::Query<::notification::inbound::http::Params>,
    cursor: Option<
        models_pagination::CursorWithValAndFilter<uuid::Uuid, models_pagination::CreatedAt, ()>,
    >,
) -> Result<
    axum::Json<GetAllUserNotificationsResponse>,
    (
        axum::http::StatusCode,
        axum::Json<model_error_response::ErrorResponse<'static>>,
    ),
> {
    let user = decoded_jwt.macro_user_id.clone();
    let axum::Json(response) = ::notification::inbound::http::list_user_notifications::<
        S,
        serde_json::Value,
    >(&state, decoded_jwt, query, cursor)
    .await?;

    let (notifs, failed): (Vec<_>, Vec<_>) = response
        .items
        .into_iter()
        .map(|r| (r.notification_id, to_typed_row(r)))
        .partition_map(|r| match r {
            (_id, Ok(notif)) => Either::Left(notif),
            (id, Err(e)) => Either::Right((id, e)),
        });

    if !failed.is_empty() {
        tokio::task::spawn(
            CleanUpNotificationsTask {
                service: state,
                user,
                failed_notifs: failed,
            }
            .delete_failures(),
        );
    }

    Ok(axum::Json(GetAllUserNotificationsResponse {
        items: notifs
            .into_iter()
            .map(ApiUserNotification::from_notification)
            .collect(),
        next_cursor: response.next_cursor,
    }))
}

struct CleanUpNotificationsTask<S> {
    service: NotificationRouterState<S>,
    user: MacroUserIdStr<'static>,
    failed_notifs: Vec<(Uuid, serde_json::Error)>,
}

impl<S> CleanUpNotificationsTask<S>
where
    S: NotificationReader,
{
    async fn delete_failures(self) {
        let CleanUpNotificationsTask {
            service,
            failed_notifs,
            user,
        } = self;

        fn filter_erors((uuid, err): (Uuid, serde_json::Error)) -> Option<Uuid> {
            let err_str = err.to_string();

            (err_str.contains("channel_message_document")
                || err_str.contains("missing field `toEmail`")
                || err_str.contains("missing field `sender`")
                || err_str.contains("missing field `threadId`"))
            .then_some(uuid)
        }

        let to_delete: Vec<_> = failed_notifs.into_iter().filter_map(filter_erors).collect();

        let _ = service
            .inner
            .bulk_delete_user_notifications(user, to_delete.as_slice())
            .await;
    }
}

/// Wrapper handler that calls the inner generic bulk-get handler with `serde_json::Value`,
/// then converts each row to [`UserNotificationRow<NotifEvent>`].
///
/// Rows that fail to deserialize are dropped with a warning log.
#[utoipa::path(
    post,
    operation_id = "bulk_get_typed_notifications_by_event_item_ids",
    path = "/v1/user_notifications/item/bulk",
    params(
        ("limit" = Option<u32>, Query, description = "Size limit per page. Default 20, max 500."),
        ("cursor" = Option<String>, Query, description = "Cursor value. Base64 encoded timestamp and item id."),
    ),
    request_body = ::notification::inbound::http::BulkGetByEventItemIdsRequest,
    responses(
        (status = 200, body = GetAllUserNotificationsResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
async fn bulk_get_typed_notifications_by_event_item_ids<
    S: ::notification::domain::service::NotificationReader,
>(
    state: axum::extract::State<::notification::inbound::http::NotificationRouterState<S>>,
    decoded_jwt: decode_jwt::DecodedJwt,
    query: axum::extract::Query<::notification::inbound::http::Params>,
    cursor: Option<
        models_pagination::CursorWithValAndFilter<uuid::Uuid, models_pagination::CreatedAt, ()>,
    >,
    body: axum::Json<::notification::inbound::http::BulkGetByEventItemIdsRequest>,
) -> Result<
    axum::Json<GetAllUserNotificationsResponse>,
    (
        axum::http::StatusCode,
        axum::Json<model_error_response::ErrorResponse<'static>>,
    ),
> {
    let axum::Json(response) = ::notification::inbound::http::bulk_get_by_event_item_ids::<
        S,
        serde_json::Value,
    >(state, decoded_jwt, query, cursor, body)
    .await?;

    let items = response
        .items
        .into_iter()
        .filter_map(|row| {
            to_typed_row(row)
                .inspect_err(|e| tracing::warn!(error=?e, "failed to deserialize notification row"))
                .ok()
        })
        .map(ApiUserNotification::from_notification)
        .collect();

    Ok(axum::Json(GetAllUserNotificationsResponse {
        items,
        next_cursor: response.next_cursor,
    }))
}

/// Typed wrapper for getting notifications by a single event item ID.
#[utoipa::path(
    get,
    operation_id = "get_typed_notifications_by_event_item_id",
    path = "/v1/user_notifications/item/{event_item_id}",
    params(
        ("event_item_id" = uuid::Uuid, Path, description = "The event item ID"),
        ("limit" = Option<u32>, Query, description = "Size limit per page."),
        ("cursor" = Option<String>, Query, description = "Cursor value. Base64 encoded timestamp and item id."),
    ),
    responses(
        (status = 200, body = GetAllUserNotificationsResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
async fn get_typed_by_event_item_id<S: ::notification::domain::service::NotificationReader>(
    state: axum::extract::State<::notification::inbound::http::NotificationRouterState<S>>,
    decoded_jwt: decode_jwt::DecodedJwt,
    path: axum::extract::Path<::notification::inbound::http::EventItemIdPath>,
    query: axum::extract::Query<::notification::inbound::http::Params>,
    cursor: Option<
        models_pagination::CursorWithValAndFilter<uuid::Uuid, models_pagination::CreatedAt, ()>,
    >,
) -> Result<
    axum::Json<GetAllUserNotificationsResponse>,
    (
        axum::http::StatusCode,
        axum::Json<model_error_response::ErrorResponse<'static>>,
    ),
> {
    let axum::Json(response) = ::notification::inbound::http::get_by_event_item_id::<
        S,
        serde_json::Value,
    >(state, decoded_jwt, path, query, cursor)
    .await?;

    let items = response
        .items
        .into_iter()
        .filter_map(|row| {
            to_typed_row(row)
                .inspect_err(|e| tracing::warn!(error=?e, "failed to deserialize notification row"))
                .ok()
        })
        .map(ApiUserNotification::from_notification)
        .collect();

    Ok(axum::Json(GetAllUserNotificationsResponse {
        items,
        next_cursor: response.next_cursor,
    }))
}

/// Typed wrapper for getting a single notification by ID.
#[utoipa::path(
    get,
    operation_id = "get_typed_notification_by_id",
    path = "/v1/user_notifications/{notification_id}",
    params(
        ("notification_id" = uuid::Uuid, Path, description = "ID of the notification"),
    ),
    responses(
        (status = 200, body = ApiUserNotification),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
async fn get_typed_notification_by_id<S: ::notification::domain::service::NotificationReader>(
    state: axum::extract::State<::notification::inbound::http::NotificationRouterState<S>>,
    decoded_jwt: decode_jwt::DecodedJwt,
    path: axum::extract::Path<::notification::inbound::http::NotificationIdPath>,
) -> Result<
    axum::Json<ApiUserNotification>,
    (
        axum::http::StatusCode,
        axum::Json<model_error_response::ErrorResponse<'static>>,
    ),
> {
    let axum::Json(row) = ::notification::inbound::http::get_notification_by_id::<
        S,
        serde_json::Value,
    >(state, decoded_jwt, path)
    .await?;

    let typed = to_typed_row(row).map_err(|e| {
        tracing::error!(error=?e, "failed to deserialize notification row");
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(model_error_response::ErrorResponse {
                message: "failed to convert notification".into(),
            }),
        )
    })?;

    Ok(axum::Json(ApiUserNotification::from_notification(typed)))
}
