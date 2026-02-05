use ::notification::domain::models::UserNotificationRow;
use chrono::{DateTime, Utc, serde::ts_seconds_option};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use model_error_response::ErrorResponse;
use model_notifications::{
    ChannelInviteMetadata, ChannelMentionMetadata, ChannelMessageSendMetadata,
    ChannelReplyMetadata, DocumentMentionMetadata, InviteToTeamMetadata, NewEmailMetadata,
    TaskAssignedMetadata,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[cfg(test)]
mod test;

/// Defines a notification event enum with compile-time safety guarantees.
///
/// The `tag` field in the database row is the `Notification::TYPE_NAME` of the
/// metadata that was stored. When we deserialize that row back into this enum,
/// serde matches the `tag` value against the `snake_case` of the variant name.
/// If those two strings ever diverge, deserialization fails at runtime.
/// This macro prevents that by asserting the invariant at compile time.
///
/// Accepts a standard enum definition and emits it unchanged, then generates
/// `const` assertions that verify two properties for every `Variant(MetadataType)`:
///
/// 1. `MetadataType` implements [`Notification`](::notification::domain::models::Notification).
/// 2. `MetadataType::TYPE_NAME` equals the variant name converted to `snake_case`
///    (via [`paste`]), which is also the serde tag produced by `rename_all = "snake_case"`.
///
/// Because the enum and the assertions share the same variant list, adding a new
/// variant without a matching `Notification` impl — or with a mismatched
/// `TYPE_NAME` — is a compile error.
macro_rules! define_notif_event {
    (
        $(#[$enum_meta:meta])*
        $vis:vis enum $Name:ident {
            $(
                $(#[$variant_meta:meta])*
                $Variant:ident($(#[$field_meta:meta])* $Ty:ty),
            )+
        }
    ) => {
        $(#[$enum_meta])*
        $vis enum $Name {
            $(
                $(#[$variant_meta])*
                $Variant($(#[$field_meta])* $Ty),
            )+
        }

        // Compile-time assertions:
        // 1. Every inner type implements Notification.
        // 2. TYPE_NAME matches the snake_case of the variant name.
        paste::paste! {
            const _: () = {
                const fn str_eq(a: &[u8], b: &[u8]) -> bool {
                    if a.len() != b.len() { return false; }
                    let mut i = 0;
                    while i < a.len() {
                        if a[i] != b[i] { return false; }
                        i += 1;
                    }
                    true
                }

                $(
                    const _: () = assert!(
                        str_eq(
                            <$Ty as ::notification::domain::models::Notification>::TYPE_NAME.as_bytes(),
                            stringify!([< $Variant:snake >]).as_bytes(),
                        ),
                        concat!(
                            stringify!($Name), "::", stringify!($Variant),
                            " snake_case does not match Notification::TYPE_NAME for ", stringify!($Ty),
                        ),
                    );
                )+
            };
        }
    };
}

define_notif_event!(
    /// Mirrors [`model_notifications::NotificationEvent`] but uses `tag` / `content`
    /// as the serde adjacently-tagged field names so it can be deserialized from the
    /// shape produced by [`UserNotificationRow::into_tagged`] +
    /// [`UserNotificationRow::into_json`].
    ///
    /// Only includes variants whose metadata types implement the `Notification` trait.
    #[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
    #[serde(tag = "tag", content = "content", rename_all = "snake_case")]
    pub enum NotifEvent {
        /// Someone mentioned you in a channel.
        #[schema(value_type = serde_json::Value)]
        ChannelMention(ChannelMentionMetadata),

        /// Someone mentioned you in a document.
        #[schema(value_type = serde_json::Value)]
        DocumentMention(DocumentMentionMetadata),
        /// The user was invited to a channel.
        #[schema(value_type = serde_json::Value)]
        ChannelInvite(ChannelInviteMetadata),

        /// A user sent a message in a channel.
        #[schema(value_type = serde_json::Value)]
        ChannelMessageSend(ChannelMessageSendMetadata),

        /// Someone replied to a thread in a channel that the user is part of.
        #[schema(value_type = serde_json::Value)]
        ChannelMessageReply(ChannelReplyMetadata),

        /// A new email has been sent to the user.
        #[schema(value_type = serde_json::Value)]
        NewEmail(NewEmailMetadata),

        /// A user was invited to a team.
        #[schema(value_type = serde_json::Value)]
        InviteToTeam(InviteToTeamMetadata),

        /// A user was assigned to a task.
        #[schema(value_type = serde_json::Value)]
        TaskAssigned(TaskAssignedMetadata),
    }
);

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
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
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable = false)]
    pub created_at: Option<DateTime<Utc>>,
    /// When the notification was viewed/seen.
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable = true)]
    pub viewed_at: Option<DateTime<Utc>>,
    /// When the notification was last updated.
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable = true)]
    pub updated_at: Option<DateTime<Utc>>,
    /// When the notification was deleted.
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable = true)]
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
pub fn to_typed_row(
    row: UserNotificationRow<serde_json::Value>,
) -> Result<UserNotificationRow<NotifEvent>, serde_json::Error> {
    row.into_tagged()
        .into_json()?
        .deserialize_json::<NotifEvent>()
}

/// Build the strongly typed router.
///
/// Instantiates the notification crate's generic router, then overwrites the
/// GET `/` route with a wrapper that deserializes each row into [`NotifEvent`].
pub fn router<
    S: ::notification::domain::service::NotificationIngress,
    O: Clone + Send + Sync + 'static,
>(
    state: ::notification::inbound::http::NotificationRouterState<S>,
) -> axum::Router<O> {
    ::notification::inbound::http::router::<S, serde_json::Value>()
        .route("/", axum::routing::get(list_typed_notifications::<S>))
        .route(
            "/item/bulk",
            axum::routing::post(bulk_get_typed_notifications_by_event_item_ids::<S>),
        )
        .route(
            "/item/:event_item_id",
            axum::routing::get(get_typed_by_event_item_id::<S>),
        )
        .route(
            "/:notification_id",
            axum::routing::get(get_typed_notification_by_id::<S>)
                .delete(::notification::inbound::http::delete_notification::<S>),
        )
        .route(
            "/bulk",
            axum::routing::delete(::notification::inbound::http::bulk_delete_notifications::<S>),
        )
        .with_state(state)
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
async fn list_typed_notifications<S: ::notification::domain::service::NotificationIngress>(
    state: axum::extract::State<::notification::inbound::http::NotificationRouterState<S>>,
    macro_user: model_user::axum_extractor::MacroUserExtractor,
    query: axum::extract::Query<::notification::inbound::http::Params>,
    cursor: models_pagination::CursorExtractor<uuid::Uuid, models_pagination::CreatedAt, ()>,
) -> Result<
    axum::Json<GetAllUserNotificationsResponse>,
    (
        axum::http::StatusCode,
        axum::Json<model_error_response::ErrorResponse<'static>>,
    ),
> {
    let axum::Json(response) = ::notification::inbound::http::list_user_notifications::<
        S,
        serde_json::Value,
    >(state, macro_user, query, cursor)
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
    S: ::notification::domain::service::NotificationIngress,
>(
    state: axum::extract::State<::notification::inbound::http::NotificationRouterState<S>>,
    macro_user: model_user::axum_extractor::MacroUserExtractor,
    query: axum::extract::Query<::notification::inbound::http::Params>,
    cursor: models_pagination::CursorExtractor<uuid::Uuid, models_pagination::CreatedAt, ()>,
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
    >(state, macro_user, query, cursor, body)
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
async fn get_typed_by_event_item_id<S: ::notification::domain::service::NotificationIngress>(
    state: axum::extract::State<::notification::inbound::http::NotificationRouterState<S>>,
    macro_user: model_user::axum_extractor::MacroUserExtractor,
    path: axum::extract::Path<::notification::inbound::http::EventItemIdPath>,
    query: axum::extract::Query<::notification::inbound::http::Params>,
    cursor: models_pagination::CursorExtractor<uuid::Uuid, models_pagination::CreatedAt, ()>,
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
    >(state, macro_user, path, query, cursor)
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
async fn get_typed_notification_by_id<S: ::notification::domain::service::NotificationIngress>(
    state: axum::extract::State<::notification::inbound::http::NotificationRouterState<S>>,
    macro_user: model_user::axum_extractor::MacroUserExtractor,
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
    >(state, macro_user, path)
    .await?;

    let typed = to_typed_row(row).map_err(|e| {
        tracing::error!(error=?e, "failed to deserialize notification row");
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(model_error_response::ErrorResponse {
                message: "failed to convert notification",
            }),
        )
    })?;

    Ok(axum::Json(ApiUserNotification::from_notification(typed)))
}
