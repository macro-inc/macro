use crate::api::context::ApiContext;
use axum::{Router, routing::post};
pub(in crate::api) mod create_in_progress_link;
pub(in crate::api) mod github;

/// The link router
/// All routes have IPContext attached via the `macro_middleware::tracking::attach_ip_context_handler`.
/// We ensure the user is logged in with the `macro_middleware::auth::decode_jwt::handler`.
pub fn router(_state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .route("/", post(create_in_progress_link::handler))
        .route("/github", post(github::init_github_link_handler))
}
