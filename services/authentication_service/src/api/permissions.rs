use crate::api::ApiContext;
use axum::{Router, routing::get};

// needs to be public in api crate for swagger
pub(in crate::api) mod get_permissions;
pub(in crate::api) mod get_user_permissions;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/", get(get_permissions::handler))
        .route("/me", get(get_user_permissions::handler))
}
