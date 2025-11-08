use axum::{
    Router,
    routing::{get, post},
};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use tower::ServiceBuilder;

use crate::api::context::ApiContext;

pub(in crate::api) mod generate_email_link;
pub(in crate::api) mod resend_fusionauth_verify_user_email;
pub(in crate::api) mod verify_email_link;
pub(in crate::api) mod verify_fusionauth_user_email;

#[allow(dead_code)]
pub fn router(jwt_args: JwtValidationArgs) -> Router<ApiContext> {
    Router::new()
        .route(
            "/verify/fusionauth/:verification_id",
            get(verify_fusionauth_user_email::handler),
        )
        .route(
            "/resend/fusionauth",
            post(resend_fusionauth_verify_user_email::handler),
        )
        .route("/verify/:verification_id", get(verify_email_link::handler))
        .merge(router_with_auth(jwt_args))
}

fn router_with_auth(jwt_args: JwtValidationArgs) -> Router<ApiContext> {
    Router::new()
        .route("/generate/link", post(generate_email_link::handler))
        .layer(
            ServiceBuilder::new().layer(axum::middleware::from_fn_with_state(
                jwt_args,
                macro_middleware::auth::decode_jwt::handler,
            )),
        )
}
