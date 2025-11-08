use axum::{Router, routing::get};
use tower::ServiceBuilder;
use tower_cookies::CookieManagerLayer;

use crate::api::ApiContext;

use super::middleware;

// needs to be public in api crate for swagger
pub(in crate::api) mod oauth_redirect;
pub(in crate::api) mod passwordless_callback;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .route(
            "/passwordless/:code",
            get(passwordless_callback::handler).layer(
                ServiceBuilder::new()
                    .layer(CookieManagerLayer::new())
                    .layer(axum::middleware::from_fn(
                        macro_middleware::tracking::attach_ip_context_handler,
                    ))
                    .layer(axum::middleware::from_fn_with_state(
                        state.clone(),
                        middleware::rate_limit::login_code::handler,
                    )),
            ),
        )
        .route(
            "/redirect",
            get(oauth_redirect::handler)
                .layer(ServiceBuilder::new().layer(CookieManagerLayer::new())),
        )
}
