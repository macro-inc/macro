// login via session
// generate session via refresh token
use axum::{
    Router,
    routing::{get, post},
};
use tower::ServiceBuilder;
use tower_cookies::CookieManagerLayer;

use crate::api::context::ApiContext;

use super::middleware;

pub(in crate::api) mod session_creation;
pub(in crate::api) mod session_login;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route(
            "/login/:session_code",
            get(session_login::handler)
                .layer(ServiceBuilder::new().layer(CookieManagerLayer::new())),
        )
        .route(
            "/",
            post(session_creation::handler).layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn(
                        middleware::extract_tokens::handler,
                    ))
                    .layer(CookieManagerLayer::new()),
            ),
        )
}
