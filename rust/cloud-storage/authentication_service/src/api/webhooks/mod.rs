use crate::api::context::ApiContext;
use axum::Router;

pub(in crate::api) mod user;

/// Webhook endpoints that use internal api key authentication
pub fn router() -> Router<ApiContext> {
    Router::new().nest("/user", user::router())
}
