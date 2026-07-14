use axum::{Router, routing::get};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;

use crate::api::ApiContext;

// needs to be public in api crate for swagger
pub(in crate::api) mod get_permissions;
pub(in crate::api) mod get_user_permissions;

pub fn router(jwt_args: JwtValidationArgs) -> Router<ApiContext> {
    Router::new()
        .route("/", get(get_permissions::handler))
        .route(
            "/me",
            get(get_user_permissions::handler).layer(axum::middleware::from_fn_with_state(
                jwt_args,
                macro_middleware::auth::decode_jwt::handler,
            )),
        )
}
