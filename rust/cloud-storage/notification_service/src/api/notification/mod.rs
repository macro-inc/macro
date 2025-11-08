use axum::{
    Router,
    routing::{delete, post},
};

use crate::api::context::ApiContext;

pub(in crate::api) mod create_notification;
pub(in crate::api) mod delete_user_notifications;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/", post(create_notification::handler))
        .route("/user/:user_id", delete(delete_user_notifications::handler))
}
