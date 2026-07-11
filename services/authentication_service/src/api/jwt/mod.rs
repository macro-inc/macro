use axum::{
    Router,
    routing::{get, post},
};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use tower::ServiceBuilder;
use tower_cookies::CookieManagerLayer;

use crate::api::context::ApiContext;

use super::middleware;

// needs to be public in api crate for swagger
pub(in crate::api) mod macro_api_token;
pub(in crate::api) mod refresh;

pub fn router(jwt_args: JwtValidationArgs) -> Router<ApiContext> {
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
        .route(
            "/macro_api_token",
            get(macro_api_token::handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn_with_state(
                    jwt_args,
                    macro_middleware::auth::decode_jwt::handler, // Decodes the JWT to create
                                                                 // user context
                ),
            )),
        )
}
