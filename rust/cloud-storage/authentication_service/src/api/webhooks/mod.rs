use crate::api::context::ApiContext;
use axum::Router;
use github::inbound::webhook_router::{GithubWebhookRouterState, github_webhook_router};

pub(in crate::api) mod user;

/// Webhook endpoints that use internal api key authentication
pub fn router(state: ApiContext) -> Router<ApiContext> {
    let github_webhook_router_state = GithubWebhookRouterState {
        service: state.github_service,
    };

    Router::new()
        .merge(github_webhook_router(github_webhook_router_state))
        .nest("/user", user::router())
}
