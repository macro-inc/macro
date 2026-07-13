use crate::api::context::ApiContext;
use axum::{
    Router,
    routing::{delete, get, post},
};
pub(in crate::api) mod create_in_progress_link;
pub(in crate::api) mod github;
pub(in crate::api) mod gmail;

/// The link router
/// We ensure the user is logged in with the `macro_middleware::auth::decode_jwt::handler`.
pub fn router(_state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .route("/", post(create_in_progress_link::handler))
        .route("/github", post(github::init_github_link_handler))
        .route("/github", delete(github::delete_github_link_handler))
        .route(
            "/github/status",
            get(github::check_github_link_status_handler),
        )
        .route("/gmail", post(gmail::init_gmail_link_handler))
        .route("/gmail/status", get(gmail::check_gmail_link_status_handler))
}
