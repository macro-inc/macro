use axum::{Router, routing::delete};

use crate::api::context::ApiContext;

pub(in crate::api) mod delete_user_notifications;

pub fn router() -> Router<ApiContext> {
    Router::new().route("/user/:user_id", delete(delete_user_notifications::handler))
}
