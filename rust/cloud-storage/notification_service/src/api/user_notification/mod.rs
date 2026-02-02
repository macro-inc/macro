use crate::api::context::ApiContext;
use axum::{
    Router,
    routing::{delete, get, post},
};

pub(in crate::api) mod bulk_delete_user_notification;
pub(in crate::api) mod bulk_get_user_notifications_by_event_item_id;
pub(in crate::api) mod delete_user_notification;
pub(in crate::api) mod get_user_notification_by_id;
pub(in crate::api) mod get_user_notifications_by_event_item_id;

pub fn router() -> Router<ApiContext> {
    Router::new()
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
            get(get_user_notification_by_id::handler).delete(delete_user_notification::handler),
        )
        .route("/bulk", delete(bulk_delete_user_notification::handler))
}
