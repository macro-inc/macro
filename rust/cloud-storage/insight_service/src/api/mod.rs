pub(in crate::api) mod api_context;
pub mod swagger;
pub(in crate::api) mod user_insight;

pub use api_context::*;

use axum::Router;

pub fn router() -> Router<ApiContext> {
    Router::new().nest("/user_insight", user_insight::router())
}
