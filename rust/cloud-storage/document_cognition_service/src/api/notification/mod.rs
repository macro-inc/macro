use crate::api::context::ApiContext;
use axum::{Router, routing::get};
pub(in crate::api) mod get_chat_notification_users;

/// Notifications router is nested under the internal router
/// This means that the notifications calls are only accessible via internal api key
pub fn router() -> Router<ApiContext> {
    Router::new().route("/chat/:chat_id", get(get_chat_notification_users::handler))
}
