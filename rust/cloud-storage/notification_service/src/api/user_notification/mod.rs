use crate::api::context::ApiContext;
use axum::{
    Router,
    routing::{delete, get, patch, post},
};

pub(in crate::api) mod bulk_delete_user_notification;
pub(in crate::api) mod bulk_get_user_notifications_by_event_item_id;
pub(in crate::api) mod bulk_mark_user_notification_done;
pub(in crate::api) mod bulk_mark_user_notification_done_by_event;
pub(in crate::api) mod bulk_mark_user_notification_seen;
pub(in crate::api) mod bulk_mark_user_notification_seen_by_event;
pub(in crate::api) mod delete_user_notification;
pub(in crate::api) mod get_user_notification;
pub(in crate::api) mod get_user_notifications_by_event_item_id;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/", get(get_user_notification::handler))
        .route(
            "/item/bulk",
            post(bulk_get_user_notifications_by_event_item_id::handler),
        )
        .route(
            "/item/:event_item_id",
            get(get_user_notifications_by_event_item_id::handler),
        )
        .route(
            "/:notification_id",
            delete(delete_user_notification::handler),
        )
        .route("/bulk", delete(bulk_delete_user_notification::handler))
        .route(
            "/bulk/seen",
            patch(bulk_mark_user_notification_seen::handler),
        )
        .route(
            "/bulk/done",
            patch(bulk_mark_user_notification_done::handler),
        )
        .route(
            "/item/:event_item_id/seen",
            patch(bulk_mark_user_notification_seen_by_event::handler),
        )
        .route(
            "/item/:event_item_id/done",
            patch(bulk_mark_user_notification_done_by_event::handler),
        )
}
