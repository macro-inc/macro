use axum::{
    Router,
    routing::{get, post},
};
use tower::ServiceBuilder;
use tower_cookies::CookieManagerLayer;

use crate::api::ApiContext;

use super::middleware;

// needs to be public in api crate for swagger
pub(in crate::api) mod apple;
pub(in crate::api) mod password;
pub(in crate::api) mod passwordless;
pub(in crate::api) mod sso;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .route(
            "/passwordless",
            post(passwordless::handler).layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn(
                        macro_middleware::tracking::attach_ip_context_handler,
                    ))
                    .layer(axum::middleware::from_fn_with_state(
                        state.clone(),
                        middleware::rate_limit::passwordless::handler,
                    )),
            ),
        )
        .route(
            "/password",
            post(password::handler).layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn(
                        macro_middleware::tracking::attach_ip_context_handler,
                    ))
                    .layer(CookieManagerLayer::new()),
            ),
        )
        .route(
            "/apple",
            post(apple::handler).layer(ServiceBuilder::new().layer(CookieManagerLayer::new())),
        )
        .route("/sso", get(sso::handler))
}
