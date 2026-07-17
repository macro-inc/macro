use axum::{
    Router,
    routing::{get, post},
};
use tower::ServiceBuilder;
use tower_cookies::CookieManagerLayer;

use crate::api::context::ApiContext;

use super::middleware;

// needs to be public in api crate for swagger
pub(in crate::api) mod macro_api_token;
pub(in crate::api) mod refresh;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route(
            "/refresh",
            post(refresh::handler).layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn(
                        middleware::extract_tokens::handler,
                    ))
                    .layer(CookieManagerLayer::new()),
            ),
        )
        .route("/macro_api_token", get(macro_api_token::handler))
}
