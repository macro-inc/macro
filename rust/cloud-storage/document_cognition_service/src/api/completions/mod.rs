pub mod get_completion;
pub mod structured_output;
use axum::{Router, routing::post};
use tower::ServiceBuilder;

pub fn router() -> Router {
    Router::new()
        .route(
            "/structured_output",
            post(structured_output::handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn(macro_middleware::auth::ensure_user_exists::handler),
            )),
        )
        .route(
            "/get_completion",
            post(get_completion::get_completion_handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn(macro_middleware::auth::ensure_user_exists::handler),
            )),
        )
}
