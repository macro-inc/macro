use crate::api::context::ApiContext;
use axum::{
    Router,
    routing::{get, post},
};

pub(in crate::api) mod affiliate_user;
pub(in crate::api) mod get_affiliate_referred_by;
pub(in crate::api) mod get_affiliate_users;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .route("/:affiliate_code", post(affiliate_user::handler))
        .route("/", get(get_affiliate_users::handler))
        .route("/referred_by", get(get_affiliate_referred_by::handler))
        .layer(axum::middleware::from_fn_with_state(
            state,
            macro_middleware::auth::ensure_user_exists::handler,
        ))
}
