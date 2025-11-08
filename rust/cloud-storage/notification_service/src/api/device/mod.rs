use axum::{
    Router,
    routing::{delete, post},
};
use tower::ServiceBuilder;

use crate::api::context::ApiContext;

pub(in crate::api) mod register;
pub(in crate::api) mod unregister;
pub fn router() -> Router<ApiContext> {
    Router::new()
        .route(
            "/register",
            post(register::handler).layer(ServiceBuilder::new().layer(axum::middleware::from_fn(
                macro_middleware::auth::ensure_user_exists::handler,
            ))),
        )
        .route("/unregister", delete(unregister::handler))
}
