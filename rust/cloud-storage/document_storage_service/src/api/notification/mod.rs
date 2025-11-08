use axum::{Router, routing::get};

use crate::api::context::ApiContext;

pub(in crate::api) mod get_document_notification_users;
pub(in crate::api) mod get_project_notification_users;

/// Notifications router is nested under the internal router
/// This means that the notifications calls are only accessible via internal api key
pub fn router() -> Router<ApiContext> {
    Router::new()
        .route(
            "/document/:document_id",
            get(get_document_notification_users::handler),
        )
        .route(
            "/project/:project_id",
            get(get_project_notification_users::handler),
        )
}
