use crate::api::context::ApiContext;
use axum::{
    Router,
    routing::{delete, get, post},
};
pub(in crate::api) mod create_in_progress_link;
pub(in crate::api) mod github;
pub(in crate::api) mod gmail;
pub(in crate::api) mod outlook;

/// Routes for authenticated account-link operations.
pub fn router(state: ApiContext) -> Router<ApiContext> {
    // Starting a Google or GitHub link returns a consent URL any browser can
    // finish, adding a sign-in for whoever finishes it: people only.
    let people_only = axum::middleware::from_fn_with_state(
        state.authorization_state.clone(),
        super::middleware::refuse_program_link::handler,
    );
    Router::new()
        .route("/", post(create_in_progress_link::handler))
        .route(
            "/github",
            post(github::init_github_link_handler).layer(people_only.clone()),
        )
        .route("/github", delete(github::delete_github_link_handler))
        .route(
            "/github/status",
            get(github::check_github_link_status_handler),
        )
        .route(
            "/gmail",
            post(gmail::init_gmail_link_handler).layer(people_only),
        )
        .route("/gmail/status", get(gmail::check_gmail_link_status_handler))
        .route("/outlook", post(outlook::init_outlook_link_handler))
        .route("/email/providers", get(outlook::email_connection_providers))
}
