use axum::{Router, routing::get};

use crate::api::context::ApiContext;

pub(in crate::api) mod get_document_notification_users;
pub(in crate::api) mod get_project_notification_users;

/// Notifications router nested under the internal router.
/// Each notification handler authenticates requests with an internal API key extractor.
pub fn router() -> Router<ApiContext> {
    Router::new()
        .route(
            "/document/{document_id}",
            get(get_document_notification_users::handler),
        )
        .route(
            "/project/{project_id}",
            get(get_project_notification_users::handler),
        )
}
